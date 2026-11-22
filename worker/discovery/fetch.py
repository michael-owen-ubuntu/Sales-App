"""Fetch only configured HTTPS pages and their robots.txt files."""

import http.client
import ipaddress
import socket
import ssl
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit

from .config import Settings, Source, WorkerError
from .robots import Robots

AGENT = "GPISalesDiscovery"
RETRYABLE = {408, 425, 429, 500, 502, 503, 504}


@dataclass(frozen=True)
class Response:
    status: int
    body: bytes
    content_type: str = ""
    retry_after: str | None = None


class PublicHTTPSConnection(http.client.HTTPSConnection):
    def connect(self):
        addresses = socket.getaddrinfo(self.host, self.port, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(info[4][0]).is_global for info in addresses):
            raise WorkerError("Source DNS did not resolve exclusively to public IP addresses.")
        # Connect to the validated address while checking TLS against the original hostname.
        raw = socket.create_connection((addresses[0][4][0], self.port), self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except BaseException:
            raw.close()
            raise


def transport(url: str, timeout: float, max_bytes: int, deadline: float) -> Response:
    parts = urlsplit(url)
    connection = PublicHTTPSConnection(parts.hostname, timeout=timeout, context=ssl.create_default_context())
    try:
        target = parts.path + (f"?{parts.query}" if parts.query else "")
        connection.request("GET", target, headers={
            "User-Agent": f"{AGENT}/1.0", "Accept": "text/html, application/xhtml+xml, text/plain, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Accept-Encoding": "identity", "Connection": "close",
        })
        response = connection.getresponse()
        retry_after = response.getheader("Retry-After")
        if response.status != 200:
            return Response(response.status, b"", retry_after=retry_after)
        if response.getheader("Content-Encoding", "identity").lower() != "identity":
            raise WorkerError("Compressed source responses are unsupported.")
        body = bytearray()
        while True:
            if time.monotonic() >= deadline:
                raise WorkerError("Source request time budget exhausted.")
            chunk = response.read1(min(65536, max_bytes - len(body) + 1))
            if not chunk:
                break
            body.extend(chunk)
            if len(body) > max_bytes:
                raise WorkerError("Source response exceeded the byte limit.")
        return Response(response.status, bytes(body), response.headers.get_content_type(), retry_after)
    finally:
        connection.close()


@dataclass
class HostState:
    lock: threading.Lock = field(default_factory=threading.Lock)
    next_request: float = 0
    interval: float = 0
    robots: Robots | bool | None = None


def retry_delay(value: str | None) -> float:
    if not value:
        return 0
    try:
        return min(3600, max(0, int(value)))
    except ValueError:
        try:
            return max(0, (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
        except (ValueError, TypeError, OverflowError):
            return 0


class Fetcher:
    def __init__(self, settings: Settings, request=transport, *, monotonic=time.monotonic, sleep=time.sleep):
        self.settings = settings
        self.request = request
        self.monotonic = monotonic
        self.sleep = sleep
        self.deadline = monotonic() + settings.max_seconds
        self.lock = threading.Lock()
        self.states: dict[str, HostState] = {}
        self.requests = 0

    def _get(self, url: str, state: HostState, max_bytes: int) -> Response:
        for attempt in range(self.settings.retries + 1):
            delay = max(0, state.next_request - self.monotonic())
            if self.monotonic() + delay >= self.deadline:
                raise WorkerError("Source time budget exhausted during cooldown.")
            if delay:
                self.sleep(delay)
            with self.lock:
                if self.requests >= self.settings.max_requests:
                    raise WorkerError("Source request budget exhausted.")
                self.requests += 1
            now = self.monotonic()
            if now >= self.deadline:
                raise WorkerError("Source time budget exhausted.")
            state.next_request = now + max(state.interval, self.settings.cooldown)
            try:
                request_deadline = min(self.deadline, now + self.settings.timeout)
                response = self.request(url, request_deadline - now, max_bytes, request_deadline)
            except ssl.SSLError as error:
                raise WorkerError("Source TLS validation failed.") from error
            except (OSError, http.client.HTTPException, ValueError):
                response = None
            if response is not None and response.status not in RETRYABLE:
                return response
            wait = retry_delay(response.retry_after) if response else 0
            state.next_request = max(state.next_request, self.monotonic() + max(wait, 2 ** attempt))
        raise WorkerError(f"Source returned HTTP {response.status} after retries." if response else "Source connection failed after retries.")

    def read(self, source: Source) -> str | bytes:
        if source.fixture is not None:
            try:
                with source.fixture.open("rb") as file:
                    body = file.read(self.settings.max_bytes + 1)
            except OSError as error:
                raise WorkerError("Local fixture could not be read.") from error
            if len(body) > self.settings.max_bytes:
                raise WorkerError("Local fixture exceeded the byte limit.")
            return body if source.format == "kalbar-industry-xlsx" else body.decode("utf-8", errors="replace")

        host = urlsplit(source.url).hostname
        with self.lock:
            state = self.states.setdefault(host, HostState())
        with state.lock:
            if state.robots is None:
                robots_url = f"https://{host}/robots.txt"
                response = self._get(robots_url, state, min(self.settings.max_bytes, 512000))
                if response.status in (404, 410):
                    state.robots = True
                elif response.status == 200 and response.content_type in ("text/plain", ""):
                    state.robots = Robots(response.body, AGENT)
                    state.interval = state.robots.interval
                    if state.interval > self.settings.cooldown:
                        state.next_request += state.interval - self.settings.cooldown
                else:
                    state.robots = False
            if state.robots is False or isinstance(state.robots, Robots) and not state.robots.can_fetch(source.url):
                raise WorkerError("Source access was blocked by robots.txt or its response.")
            response = self._get(source.url, state, self.settings.max_bytes)
            if response.status != 200:
                raise WorkerError(f"Source returned HTTP {response.status}. Redirects are disabled.")
            if source.format == "kalbar-industry-xlsx":
                if response.content_type not in ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream"):
                    raise WorkerError("Source did not return an XLSX workbook.")
                return response.body
            if response.content_type not in ("text/html", "application/xhtml+xml"):
                raise WorkerError("Source did not return HTML.")
            return response.body.decode("utf-8", errors="replace")
