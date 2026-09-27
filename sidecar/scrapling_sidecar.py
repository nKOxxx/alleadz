# alleadz sidecar — Scrapling stealth transport for the discovery layer.
# Same contract as server/src/lib/discovery.js boundedFetch output:
#   {status, finalUrl, bytes, contentHash, snapshot}
# Server-side ONLY (localhost bind). Guards mirror lib/discovery.js:
#   http(s) only, SSRF host blocklist, 2 MB cap, 20s timeout. No retries here
#   (Camoufox is expensive; Node route handles fallback to plain fetch).
import hashlib
import ipaddress
import socket
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

MAX_BYTES = 2_000_000
BLOCKED_HOSTS = ("localhost", "127.", "0.0.0.0", "10.", "192.168.", "169.254.",
                 "[::1]", "172.16.", "172.17.", "172.18.", "172.19.", "172.2",
                 "172.30.", "172.31.")
ALLOWED_SCHEMES = ("http", "https")

app = FastAPI(title="alleadz-scrapling-sidecar", docs_url=None, redoc_url=None)


class FetchRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)


class FetchResponse(BaseModel):
    status: int
    finalUrl: str
    bytes: int
    contentHash: str
    snapshot: str


def guard(raw: str) -> str:
    u = urlparse(raw)
    if u.scheme not in ALLOWED_SCHEMES:
        raise HTTPException(400, "Only http(s) URLs allowed")
    host = (u.hostname or "").lower()
    if not host or any(host.startswith(b) for b in BLOCKED_HOSTS):
        raise HTTPException(400, "Blocked host (SSRF guard)")
    # resolve and refuse private/link-local IPs (DNS-level SSRF guard)
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise HTTPException(400, "Cannot resolve host")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise HTTPException(400, "Blocked host (SSRF guard)")
    return raw


@app.get("/health")
def health():
    return {"ok": True, "transport": "scrapling-stealth"}


@app.post("/fetch", response_model=FetchResponse)
def fetch(req: FetchRequest):
    guard(req.url)
    # imported here so /health stays fast and import errors surface per-request
    from scrapling.fetchers import StealthyFetcher
    try:
        page = StealthyFetcher.fetch(req.url, headless=True, timeout=20_000,
                                     network_idle=False)
    except Exception as e:  # noqa: BLE001 — sidecar returns error shape, not stack
        raise HTTPException(502, f"stealth fetch failed: {type(e).__name__}")
    snapshot = page.body if isinstance(page.body, str) else page.body.decode("utf-8", "replace")
    data = snapshot.encode("utf-8")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Response exceeds 2 MB cap")
    return FetchResponse(
        status=page.status,
        finalUrl=page.url or req.url,
        bytes=len(data),
        contentHash=hashlib.sha256(data).hexdigest(),
        snapshot=snapshot,
    )
