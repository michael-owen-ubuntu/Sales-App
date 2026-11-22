"""Read owner-approved sources and conservative limits."""

import json
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qsl, quote, unquote, urlsplit, urlunsplit


class WorkerError(Exception):
    """An operational error whose message can be written to run logs."""


def public_url(value: str) -> str:
    if not isinstance(value, str) or len(value) > 2048 or re.search(r"[\s\\\x00-\x1f]", value):
        raise ValueError("Invalid public HTTPS URL.")
    try:
        parts = urlsplit(value)
        host = (parts.hostname or "").rstrip(".").encode("idna").decode().lower()
        port = parts.port
    except (ValueError, UnicodeError) as error:
        raise ValueError("Invalid public HTTPS URL.") from error
    if (parts.scheme != "https" or not re.fullmatch(r"[a-z0-9.-]+\.[a-z]{2,63}", host)
            or host.endswith((".local", ".localhost", ".internal", ".onion"))
            or parts.username is not None or parts.password is not None or port not in (None, 443)):
        raise ValueError("Use a public HTTPS host on the standard port without credentials.")
    sensitive = {"access_token", "api_key", "apikey", "auth", "authorization", "key", "password",
                 "secret", "session", "signature", "token"}
    if any(name.lower() in sensitive for name, _ in parse_qsl(parts.query, keep_blank_values=True)):
        raise ValueError("Source URLs must not contain credential parameters.")
    if re.search(r"%(?:2f|5c|25)", parts.path, re.I) or any(
        segment in {".", ".."} for segment in unquote(parts.path).split("/")
    ):
        raise ValueError("Source URL has an ambiguous path.")
    path = quote(parts.path or "/", safe="/%:@!$&'()*+,;=-._~")
    query = quote(parts.query, safe="%/?@:!$&'()*+,;=-._~")
    return urlunsplit(("https", host, path, query, ""))


@dataclass(frozen=True)
class Source:
    id: str
    name: str
    url: str
    fixture: Path | None
    format: str = "html"
    region: str = "other"


@dataclass(frozen=True)
class Settings:
    sources: tuple[Source, ...]
    max_requests: int = 30
    max_seconds: int = 90
    concurrency: int = 2
    timeout: int = 8
    cooldown: int = 2
    max_bytes: int = 524288
    retries: int = 2
    exclude_logistics: bool = True


REGIONS = ("jabodetabek", "west-java", "java", "sumatra", "other")


BOUNDS = {
    "max_requests": (1, 100), "max_seconds": (5, 300), "concurrency": (1, 4),
    "timeout": (1, 20), "cooldown": (1, 60), "max_bytes": (1024, 2_000_000), "retries": (0, 3),
}


def read_settings(path: Path) -> Settings:
    if path.stat().st_size > 65536:
        raise ValueError("Configuration exceeds 64 KiB.")
    config = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(config, dict):
        raise ValueError("Configuration must be a JSON object.")
    unknown = config.keys() - (BOUNDS.keys() | {"exclude_logistics", "sources"})
    if unknown:
        raise ValueError("Unknown configuration setting.")
    limits = {name: config[name] for name in BOUNDS if name in config}
    for name, number in limits.items():
        low, high = BOUNDS[name]
        if type(number) is not int or not low <= number <= high:
            raise ValueError(f"{name} must be between {low} and {high}.")
    exclude = config.get("exclude_logistics", True)
    if type(exclude) is not bool:
        raise ValueError("exclude_logistics must be true or false.")
    rows = config.get("sources")
    if not isinstance(rows, list) or not 1 <= len(rows) <= 50:
        raise ValueError("Configure between 1 and 50 sources.")
    sources = []
    for row in rows:
        if not isinstance(row, dict) or row.keys() - {"id", "name", "url", "fixture", "permitted", "format", "region"}:
            raise ValueError("Invalid source definition.")
        source_id, name = row.get("id"), row.get("name")
        if not isinstance(source_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,47}", source_id):
            raise ValueError("Source IDs must use lowercase letters, digits, underscores or hyphens.")
        if any(source.id == source_id for source in sources):
            raise ValueError("Source IDs must be unique.")
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 200:
            raise ValueError("Source name must contain between 1 and 200 characters.")
        url = public_url(row.get("url"))
        fixture = None
        if "fixture" in row:
            if not urlsplit(url).hostname.endswith(".example") or not isinstance(row["fixture"], str):
                raise ValueError("Local fixtures require a .example source URL and a relative file.")
            base = path.resolve().parent
            fixture = (base / row["fixture"]).resolve()
            if Path(row["fixture"]).is_absolute() or not fixture.is_relative_to(base):
                raise ValueError("Local fixtures must stay inside the configuration directory.")
        elif row.get("permitted") is not True:
            raise ValueError("Each live source must be explicitly marked permitted.")
        source_format = row.get("format", "html")
        if source_format not in ("html", "kalbar-industry-xlsx", "bekasi-industry-html"):
            raise ValueError("Unsupported discovery source format.")
        region = row.get("region", "other")
        if region not in REGIONS:
            raise ValueError("Unknown discovery region.")
        sources.append(Source(source_id, name.strip(), url, fixture, source_format, region))
    sources.sort(key=lambda source: REGIONS.index(source.region))
    return Settings(tuple(sources), exclude_logistics=exclude, **limits)
