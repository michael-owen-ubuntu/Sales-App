"""Run permitted sources, normalize candidates and write only to discovery staging."""

import argparse
import json
import sqlite3
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from dataclasses import replace
from pathlib import Path

from .config import REGIONS, WorkerError, read_settings
from .bekasi import enrich_profile, extract_bekasi
from .extract import HermesResults, NoOpClassifier, extract, identity
from .fetch import Fetcher
from .registry import Registry, sanitize, score
from .kalbar import extract_workbook
from .upload import Supabase


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@contextmanager
def single_run(folder):
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    connection = sqlite3.connect(folder / "worker-lock.sqlite3", timeout=0)
    try:
        try:
            connection.execute("BEGIN IMMEDIATE")
        except sqlite3.OperationalError as error:
            raise WorkerError("The worker lock is unavailable. Another run may still be active.") from error
        yield
    finally:
        connection.close()


def bounded_limit(value):
    n = int(value)
    if not 1 <= n <= 100:
        raise argparse.ArgumentTypeError("limit must be between 1 and 100")
    return n


def arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True, help="Approved source configuration")
    parser.add_argument("--source", help="Run only the specified source ID")
    parser.add_argument("--limit", type=bounded_limit, default=30, help="Maximum candidates per run (default 30)")
    parser.add_argument("--dry-run", action="store_true", help="Fetch configured sources without uploading to Supabase")
    parser.add_argument("--stage-fixtures", action="store_true", help="Permit uploads of explicitly synthetic sources")
    parser.add_argument("--state-dir", type=Path, default=Path.home() / ".gpi-sales-discovery")
    parser.add_argument("--hermes-results", type=Path, help="Owner-reviewed classification result file")
    parser.add_argument("--classification-requests", type=Path, help="Write ambiguous evidence to a new local JSON file")
    return parser.parse_args(argv)


def run(args):
    settings = read_settings(args.config)
    sources = [source for source in settings.sources if not args.source or source.id == args.source]
    if not sources:
        raise WorkerError("No configured source matches --source.")
    if not args.dry_run and any(source.fixture for source in sources) and not args.stage_fixtures:
        raise WorkerError("Use --dry-run for fictional fixtures or --stage-fixtures with a test account.")
    classifier = HermesResults(args.hermes_results) if args.hermes_results else NoOpClassifier()
    fetcher = Fetcher(settings)
    started = timestamp()
    uploader = None
    registry = None
    failures = {}
    stop_reason = ""
    ambiguous = []
    candidates = []
    seen_fingerprints = set()
    seen_identities = set()
    skipped_providers = 0
    duplicates = 0
    attempted = 0
    rejected = 0
    checked_profiles = set()
    profile_failures = 0
    if not args.dry_run:
        try:
            uploader = Supabase.from_environment(fetcher.deadline)
            audience = "fixtures" if args.stage_fixtures else "live"
            registry = Registry(args.state_dir / "companies.sqlite3", f"{uploader.url}|{uploader.email.casefold()}|{audience}")
        except WorkerError as error:
            stop_reason = str(error)

    def process(source):
        try:
            contents = fetcher.read(source)
            if isinstance(contents, bytes):
                return extract_workbook(contents, source, timestamp(), settings.exclude_logistics), None
            if source.format == "bekasi-industry-html":
                return extract_bekasi(contents, source, timestamp(), settings.exclude_logistics), None
            return extract(contents, source, timestamp(), classifier, settings.exclude_logistics), None
        except WorkerError as error:
            return None, str(error)
        except (ValueError, RecursionError) as error:
            return None, f"Could not parse source ({type(error).__name__})."

    if not stop_reason:
        with ThreadPoolExecutor(max_workers=settings.concurrency) as pool:
            for offset in range(0, len(sources), settings.concurrency):
                if args.dry_run and len(candidates) >= args.limit:
                    break
                if time.monotonic() >= fetcher.deadline:
                    stop_reason = "Source time budget exhausted."
                    break
                batch = sources[offset:offset + settings.concurrency]
                for source, (result, error) in zip(batch, pool.map(process, batch)):
                    attempted += 1
                    if error:
                        failures[source.id] = error
                        continue
                    skipped_providers += result.providers_skipped
                    ambiguous.extend(result.ambiguities[:max(0, args.limit - len(ambiguous))])
                    for candidate in result.candidates:
                        if args.dry_run and len(candidates) >= args.limit:
                            break
                        fingerprint = candidate["content_fingerprint"]
                        if (source.format == "bekasi-industry-html" and not source.fixture
                                and len(checked_profiles) < min(6, args.limit)
                                and fetcher.requests < settings.max_requests - len(sources)
                                and fetcher.deadline - time.monotonic() > settings.timeout + 12
                                and fingerprint not in checked_profiles
                                and (registry is None or registry.profile_due(fingerprint))):
                            checked_profiles.add(fingerprint)
                            detail = candidate["evidence"][0]["url"]
                            try:
                                profile = fetcher.read(replace(source, url=detail))
                                candidate = enrich_profile(candidate, profile, detail, timestamp())
                                if registry is not None:
                                    registry.mark_profile_checked(fingerprint)
                            except (WorkerError, ValueError):
                                profile_failures += 1
                        try:
                            candidate = sanitize(candidate)
                        except (ValueError, TypeError, KeyError, AttributeError):
                            rejected += 1
                            continue
                        if registry is not None:
                            if not registry.remember(source.id, candidate):
                                duplicates += 1
                            continue
                        fingerprint = candidate["content_fingerprint"]
                        distinct = identity(candidate)
                        if fingerprint in seen_fingerprints or distinct is not None and distinct in seen_identities:
                            duplicates += 1
                            continue
                        seen_fingerprints.add(fingerprint)
                        if distinct is not None:
                            seen_identities.add(distinct)
                        candidates.append(candidate)

    if registry is not None:
        for region in REGIONS:
            approved = [(source.id, source.url) for source in sources if source.region == region]
            if approved and len(candidates) < args.limit:
                candidates.extend(registry.pending(args.limit - len(candidates), approved))
    else:
        candidates.sort(key=score, reverse=True)

    uploaded = 0
    upload_errors = []
    for candidate in candidates:
        if args.dry_run:
            print(json.dumps({"fingerprint": candidate["content_fingerprint"], "company": candidate["company_name"],
                              "score": score(candidate), "website": candidate["website"], "services": [item["service"] for item in candidate["suggested_services"]]}, ensure_ascii=True))
        elif uploader:
            try:
                candidate = sanitize(candidate)
                if settings.exclude_logistics and candidate["is_logistics_provider"]:
                    continue
                uploader.stage(candidate)
                registry.mark_uploaded(candidate["content_fingerprint"])
                uploaded += 1
            except (ValueError, KeyError, TypeError, AttributeError):
                rejected += 1
            except WorkerError as error:
                upload_errors.append(str(error))
                if not uploader.token or time.monotonic() >= fetcher.deadline or "budget" in str(error):
                    break

    if args.classification_requests:
        try:
            with args.classification_requests.open("x", encoding="utf-8") as file:
                json.dump(ambiguous, file, ensure_ascii=False, indent=2)
                file.write("\n")
        except OSError:
            stop_reason = stop_reason or "Could not create the classification request file."

    failed = bool(failures or stop_reason or upload_errors)
    progress = uploaded > 0 or attempted > len(failures) and (args.dry_run or not upload_errors)
    record = {
        "id": str(uuid.uuid4()), "started_at": started, "finished_at": timestamp(),
        "status": "PARTIAL" if failed and progress else "FAILED" if failed else "SUCCEEDED",
        "source": args.source or "all", "found_count": len(candidates), "uploaded_count": uploaded,
        "request_count": fetcher.requests, "failed_sources": len(failures),
        "error_summary": " | ".join(filter(None, [stop_reason, *(f"{name}: {reason}" for name, reason in failures.items()),
                                                   *dict.fromkeys(upload_errors)]))[:2000],
    }
    sync_error = None
    if uploader:
        try:
            uploader.record(record)
        except WorkerError as error:
            sync_error = str(error)
    local = {**record, "dry_run": args.dry_run, "attempted_sources": attempted, "skipped_providers": skipped_providers,
             "duplicate_candidates": duplicates, "rejected_candidates": rejected, "profile_requests": len(checked_profiles), "profile_failures": profile_failures, "source_errors": failures, "run_log_upload_error": sync_error}
    with (args.state_dir / "runs.jsonl").open("a", encoding="utf-8") as file:
        file.write(json.dumps(local) + "\n")
    print(json.dumps(local), file=sys.stderr)
    return 2 if failed or sync_error else 0


def main(argv=None):
    args = arguments(argv)
    try:
        with single_run(args.state_dir):
            return run(args)
    except (WorkerError, ValueError, OSError) as error:
        print(f"Discovery worker: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
