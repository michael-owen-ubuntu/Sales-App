"""User-scoped Supabase ingestion. Credentials never go to source hosts."""

import base64
import json
import os
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from .config import WorkerError
from .fetch import RETRYABLE, retry_delay


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def is_public_key(key: str) -> bool:
    if key.startswith("sb_publishable_"):
        return len(key) > len("sb_publishable_")
    try:
        _, payload, _ = key.split(".")
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return isinstance(claims, dict) and claims.get("role") == "anon"
    except (ValueError, UnicodeError):
        return False


class Supabase:
    def __init__(self, url: str, key: str, email: str, password: str, deadline: float, *, opener=None):
        try:
            parts = urlsplit(url)
            valid_url = bool(parts.hostname) and not (parts.username or parts.password or parts.query or parts.fragment or parts.path.rstrip("/")) and (
                parts.scheme == "https" or parts.scheme == "http" and parts.hostname in ("localhost", "127.0.0.1", "::1")
            )
        except ValueError:
            valid_url = False
        if not valid_url:
            raise WorkerError("Use an HTTPS Supabase origin or an HTTP loopback development origin.")
        if not is_public_key(key):
            raise WorkerError("Supply a Supabase publishable or legacy anon key.")
        if not email or not password:
            raise WorkerError("Supply the confirmed Supabase account email and password.")
        self.url, self.key, self.email, self.password = url.rstrip("/"), key, email, password
        self.deadline = deadline
        self.opener = opener or build_opener(ProxyHandler({}), NoRedirects())
        self.token = ""

    @classmethod
    def from_environment(cls, deadline: float):
        password = os.environ.get("DISCOVERY_PASSWORD", "")
        if not password and (directory := os.environ.get("CREDENTIALS_DIRECTORY")):
            try:
                with (Path(directory) / "supabase-password").open(encoding="utf-8") as file:
                    password = file.read(4097).rstrip("\r\n")
            except OSError as error:
                raise WorkerError("Could not read the Supabase password credential.") from error
            if len(password) > 4096:
                raise WorkerError("Supabase password credential is too large.")
        return cls(os.environ.get("DISCOVERY_SUPABASE_URL", ""), os.environ.get("DISCOVERY_SUPABASE_PUBLISHABLE_KEY", ""),
                   os.environ.get("DISCOVERY_EMAIL", ""), password, deadline)

    def _post(self, path, payload, operation, *, authenticated=True, prefer=None, deadline=None):
        deadline = self.deadline if deadline is None else deadline
        headers = {"apikey": self.key, "Content-Type": "application/json"}
        if authenticated:
            headers["Authorization"] = "Bearer " + self.token
        if prefer:
            headers["Prefer"] = prefer
        request = Request(self.url + path, json.dumps(payload).encode(), headers, method="POST")
        for attempt in range(3):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise WorkerError(f"{operation} exceeded its time budget.")
            delay = 2 ** attempt
            try:
                with self.opener.open(request, timeout=min(8, remaining)) as response:
                    body = response.read(65537)
                if len(body) > 65536:
                    raise WorkerError(f"{operation} returned an oversized response.")
                return json.loads(body) if body else None
            except HTTPError as error:
                code = error.code
                delay = max(delay, retry_delay(error.headers.get("Retry-After")))
                error.close()
                if code not in RETRYABLE or attempt == 2:
                    raise WorkerError(f"{operation} failed with HTTP {code}.") from error
            except (URLError, TimeoutError, OSError) as error:
                if attempt == 2:
                    raise WorkerError(f"{operation} failed to connect.") from error
            except (ValueError, UnicodeError) as error:
                raise WorkerError(f"{operation} returned an invalid response.") from error
            if time.monotonic() + delay >= deadline:
                raise WorkerError(f"{operation} exceeded its retry budget.")
            time.sleep(delay)

    def _authenticate(self, deadline=None):
        if self.token:
            return
        result = self._post("/auth/v1/token?grant_type=password", {"email": self.email, "password": self.password},
                            "Supabase sign-in", authenticated=False, deadline=deadline)
        token = result.get("access_token") if isinstance(result, dict) else None
        if not isinstance(token, str) or not token or "\n" in token or "\r" in token:
            raise WorkerError("Supabase sign-in returned no access token.")
        self.token = token
        self.password = ""

    def stage(self, candidate):
        self._authenticate()
        endpoint = "stage_enriched_discovery_candidate" if urlsplit(candidate["source_url"]).hostname == "dispar.bekasikab.go.id" and len(candidate["evidence"]) > 1 else "stage_discovery_candidate"
        result = self._post("/rest/v1/rpc/" + endpoint, {"details": candidate}, "Candidate staging")
        if not isinstance(result, str) or not result:
            raise WorkerError("Candidate staging returned no identifier.")

    def record(self, record):
        deadline = time.monotonic() + 8
        self._authenticate(deadline)
        self._post("/rest/v1/discovery_runs?on_conflict=user_id,id", record, "Discovery run logging",
                   prefer="resolution=ignore-duplicates,missing=default,return=minimal", deadline=deadline)
