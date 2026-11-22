import contextlib
import io
import json
import os
import tempfile
import threading
import unittest
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from discovery.__main__ import main, single_run
from discovery.bekasi import enrich_profile
from discovery.config import Settings, Source, WorkerError, public_url, read_settings
from discovery.extract import HermesResults, NoOpClassifier, extract
from discovery.fetch import Fetcher, Response
from discovery.upload import is_public_key
from discovery.robots import Robots
from discovery.registry import Registry, sanitize, score

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"
CAPTURED = "2026-11-21T07:00:00Z"


class FetchTests(unittest.TestCase):
    def setUp(self):
        self.now = 0.0
        self.history = []
        self.source = Source("test", "Fixture", "https://company.example/allowed", None)
        self.settings = Settings((self.source,), max_seconds=20, cooldown=2)
        self.robots = "https://company.example/robots.txt"

    def fetcher(self, responses, settings=None):
        def request(url, timeout, limit, deadline):
            self.history.append((url, self.now))
            self.assertGreater(timeout, 0)
            return responses.pop(0)

        def sleep(duration):
            self.now += duration

        return Fetcher(settings or self.settings, request, monotonic=lambda: self.now, sleep=sleep)

    def test_respects_paths_and_robot_cooldown(self):
        policy = b"User-agent: *\nDisallow: /private\nCrawl-delay: 4\n"
        fetcher = self.fetcher([Response(200, policy, "text/plain"), Response(200, b"ok", "text/html")])
        with self.assertRaisesRegex(WorkerError, "blocked"):
            fetcher.read(replace(self.source, url="https://company.example/private"))
        self.assertEqual(fetcher.read(self.source), "ok")
        self.assertEqual(self.history, [(self.robots, 0), (self.source.url, 4)])

    def test_honors_retry_after_and_request_budget(self):
        fetcher = self.fetcher([Response(404, b""), Response(429, b"", retry_after="5"), Response(200, b"ok", "text/html")])
        self.assertEqual(fetcher.read(self.source), "ok")
        self.assertEqual(self.history, [(self.robots, 0), (self.source.url, 2), (self.source.url, 7)])
        self.history.clear()
        self.now = 0
        fetcher = self.fetcher([Response(404, b"")], replace(self.settings, max_requests=1))
        with self.assertRaisesRegex(WorkerError, "request budget"):
            fetcher.read(self.source)
        self.assertEqual(len(self.history), 1)

    def test_does_not_follow_redirects_or_continue_after_robots_denial(self):
        fetcher = self.fetcher([Response(403, b"")])
        with self.assertRaisesRegex(WorkerError, "robots.txt"):
            fetcher.read(self.source)
        self.assertEqual(len(self.history), 1)
        self.history.clear()
        fetcher = self.fetcher([Response(404, b""), Response(302, b"")])
        with self.assertRaisesRegex(WorkerError, "Redirects are disabled"):
            fetcher.read(self.source)
        self.assertEqual(len(self.history), 2)

    def test_robots_prefers_specific_rules_and_matches_wildcard_and_end_anchor(self):
        policy = Robots(b"User-agent: *\nAllow: /\nDisallow: /*private*\nAllow: /private/report$\n", "GPISalesDiscovery")
        self.assertFalse(policy.can_fetch("https://company.example/contains-private"))
        self.assertFalse(policy.can_fetch("https://company.example/%70rivate/report?query=1"))
        self.assertTrue(policy.can_fetch("https://company.example/private/report"))

    def test_rejects_nonpublic_or_unapproved_destinations(self):
        for bad in ["http://company.example", "https://127.0.0.1", "https://person@company.example",
                    "https://other.internal", "https://company.example:444", "https://company.example\\private"]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                public_url(bad)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "sources.json"
            path.write_text(json.dumps({"sources": [{"id": "test", "name": "Test", "url": self.source.url}]}))
            with self.assertRaisesRegex(ValueError, "permitted"):
                read_settings(path)


class ExtractTests(unittest.TestCase):
    def test_evidence_provider_exclusion_and_optional_classifier(self):
        source = read_settings(EXAMPLES / "sources.json").sources[0]
        html = source.fixture.read_text()
        result = extract(html, source, CAPTURED, NoOpClassifier(), True)
        self.assertEqual(len(result.candidates), 1)
        self.assertEqual(result.providers_skipped, 1)
        self.assertEqual(len(result.ambiguities), 1)
        candidate = result.candidates[0]
        self.assertEqual(candidate["evidence"][0]["excerpt"], "We import specialty paper.")
        self.assertEqual(candidate["last_checked_at"], CAPTURED)
        self.assertNotIn("fictional-pic", json.dumps(candidate))
        self.assertEqual(len(candidate["suggested_services"]), 4)
        self.assertEqual(candidate["country_code"], "ID")
        self.assertIn("Semarang, Jawa Tengah, Indonesia", candidate["address"])
        self.assertEqual(candidate["published_contacts"]["RECEPTIONIST"]["name"], "Rani (fictional)")
        self.assertEqual(candidate["published_contacts"]["LOGISTICS_PIC"]["email"], "logistics@example.test")
        foreign = html.replace('"addressCountry": "ID"', '"addressCountry": "MY"')
        self.assertFalse(extract(foreign, source, CAPTURED, NoOpClassifier(), True).candidates)
        self.assertEqual(candidate["content_fingerprint"], extract(html, source, "2026-11-22T00:00:00Z", NoOpClassifier(), True)
                         .candidates[0]["content_fingerprint"])
        with tempfile.TemporaryDirectory() as folder:
            results = Path(folder) / "classification.json"
            results.write_text(json.dumps({result.ambiguities[0]["fingerprint"]: "PROSPECT"}))
            classified = extract(html, source, CAPTURED, HermesResults(results), False)
        self.assertEqual(len(classified.candidates), 3)
        self.assertTrue(classified.candidates[1]["is_logistics_provider"])
        self.assertEqual(classified.candidates[2]["confidence"], "LOW")
        self.assertEqual(classified.candidates[2]["suggested_services"], [])


class ProfileTests(unittest.TestCase):
    def test_requires_matching_profile_and_labeled_website(self):
        url = "https://directory.example/company"
        draft = {"company_name": "PT Example", "website": "", "evidence": [], "confidence": "LOW"}
        html = """<h1>PT Example</h1><div class="post-content">
          <p>Website resmi: <a href="https://company.example/">Company</a></p>
          <p>Website: <a href="https://www.instagram.com/company/">Instagram</a></p>
          <p>We do not export finished products.</p>
          <p>We import raw materials.</p>
          <p>Supplier: <a href="https://supplier.example/">Supplier</a></p></div>"""
        result = enrich_profile(draft, html, url, CAPTURED)
        self.assertEqual(result["website"], "https://company.example/")
        self.assertEqual([service["service"] for service in result["suggested_services"]], ["Customs clearance"])
        with self.assertRaisesRegex(WorkerError, "did not match"):
            enrich_profile(draft, html.replace("PT Example", "PT Different"), url, CAPTURED)


class RegistryTests(unittest.TestCase):
    def test_deduplicates_across_sources_and_retains_pending_rows_until_acknowledged(self):
        source = read_settings(EXAMPLES / "sources.json").sources[0]
        candidate = extract(source.fixture.read_text(), source, CAPTURED, NoOpClassifier(), True).candidates[0]
        cleaned = sanitize({**candidate, "raw_html": "Do not forward"})
        self.assertNotIn("raw_html", cleaned)
        self.assertEqual(score(cleaned), 95)
        with self.assertRaises(ValueError):
            sanitize({**candidate, "country_code": "MY"})
        with tempfile.TemporaryDirectory() as folder:
            storage = Path(folder) / "companies.sqlite3"
            self.assertTrue(Registry(storage, "account-a").remember("first", cleaned))
            registry = Registry(storage, "account-a")
            self.assertFalse(registry.remember("second", {**cleaned, "content_fingerprint": "sha256:" + "a" * 64}))
            self.assertEqual(registry.pending(10, [("second", cleaned["source_url"])]), [])
            self.assertEqual(registry.pending(10, [("first", cleaned["source_url"])]), [cleaned])
            registry.mark_uploaded(cleaned["content_fingerprint"])
            self.assertEqual(Registry(storage, "account-a").pending(10, [("first", cleaned["source_url"])]), [])
            self.assertTrue(Registry(storage, "account-b").remember("first", cleaned))


class UploaderTests(unittest.TestCase):
    def test_dry_run_and_user_scoped_upload_with_a_failed_source(self):
        requests = []
        rows = {}
        class Backend(BaseHTTPRequestHandler):
            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                requests.append((self.path, payload, self.headers.get("Authorization"), self.headers.get("Prefer")))
                if self.path.startswith("/auth/v1/token"):
                    body = json.dumps({"access_token": "fixture-token"}).encode()
                elif self.path == "/rest/v1/rpc/stage_discovery_candidate":
                    candidate = payload["details"]
                    key = candidate["content_fingerprint"]
                    rows.setdefault(key, candidate)
                    body = json.dumps(key).encode()
                else:
                    body = b""
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        with tempfile.TemporaryDirectory() as folder, ThreadingHTTPServer(("127.0.0.1", 0), Backend) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                root = Path(folder)
                (root / "directory.html").write_bytes((EXAMPLES / "directory.html").read_bytes())
                config = root / "sources.json"
                config.write_text(json.dumps({"sources": [
                    {"id": "missing", "name": "Missing", "url": "https://missing.example/", "fixture": "missing.html"},
                    {"id": "example-directory", "name": "Fixture", "url": "https://directory.example/indonesia", "fixture": "directory.html"},
                ]}))
                run_args = ["--config", str(config), "--state-dir", str(root / "state")]
                env = {
                    "DISCOVERY_SUPABASE_URL": f"http://127.0.0.1:{server.server_address[1]}",
                    "DISCOVERY_SUPABASE_PUBLISHABLE_KEY": "sb_publishable_fixture",
                    "DISCOVERY_EMAIL": "fixture@example.test",
                    "DISCOVERY_PASSWORD": "fixture-only-password",
                }
                with patch.dict(os.environ, env, clear=True), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(main(run_args + ["--dry-run", "--source", "example-directory"]), 0)
                    self.assertFalse(requests)
                    self.assertEqual(main(run_args + ["--stage-fixtures"]), 2)
                    self.assertEqual(main(run_args + ["--stage-fixtures", "--source", "example-directory", "--limit", "1"]), 0)
                self.assertEqual(len(rows), 1)
                self.assertEqual([path for path, *_ in requests], [
                    "/auth/v1/token?grant_type=password", "/rest/v1/rpc/stage_discovery_candidate", "/rest/v1/discovery_runs?on_conflict=user_id,id",
                    "/auth/v1/token?grant_type=password", "/rest/v1/discovery_runs?on_conflict=user_id,id",
                ])
                self.assertIsNone(requests[0][2])
                self.assertEqual(requests[1][2], "Bearer fixture-token")
                self.assertIn("resolution=ignore-duplicates", requests[2][3])
                self.assertEqual(requests[2][1]["status"], "PARTIAL")
                self.assertEqual(requests[2][1]["failed_sources"], 1)
                logs = (root / "state/runs.jsonl").read_text()
                self.assertNotIn(env["DISCOVERY_PASSWORD"], logs)
                self.assertNotIn("fixture-token", logs)
            finally:
                server.shutdown()
                thread.join()

    def test_prevents_overlapping_runs_and_elevated_keys(self):
        with tempfile.TemporaryDirectory() as folder, single_run(Path(folder)):
            with self.assertRaisesRegex(WorkerError, "Another run"):
                with single_run(Path(folder)):
                    self.fail("Overlapping run was allowed")
        self.assertTrue(is_public_key("sb_publishable_fixture"))
        self.assertFalse(is_public_key("sb_secret_fixture"))
        self.assertFalse(is_public_key("a.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.b"))


if __name__ == "__main__":
    unittest.main()
