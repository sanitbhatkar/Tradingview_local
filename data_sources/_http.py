"""
_http.py — shared HTTP/TLS infrastructure for all providers
============================================================
Infrastructure, not business logic (#19): TLS hardening for Windows
antivirus interception, a Chrome-impersonating curl_cffi session, and small
get/post helpers with a timeout and light retry/backoff (#12).

Importing this module performs NO network calls. It only:
  * injects the OS trust store into Python's stdlib SSL,
  * (on Windows) exports the cert store to a temp PEM for curl_cffi,
  * creates an HTTP session object.
Leading underscore => skipped by provider auto-discovery.
"""

import os
import sys
import ssl
import time
import atexit
import tempfile


# ---------------------------------------------------------------------------
# TLS / certificate hardening
# ---------------------------------------------------------------------------

def _inject_os_trust_store():
    try:
        import truststore
        truststore.inject_into_ssl()
    except Exception as exc:
        print(f"[http] truststore not active: {exc}")


def _export_windows_certs_for_curl():
    if sys.platform != "win32":
        return
    try:
        pem_blocks = []
        for store_name in ("ROOT", "CA"):
            try:
                for cert_bytes, enc_type, _trust in ssl.enum_certificates(store_name):
                    if enc_type == "x509_asn":
                        pem_blocks.append(ssl.DER_cert_to_PEM_cert(cert_bytes))
            except Exception:
                pass
        if not pem_blocks:
            return
        fd, path = tempfile.mkstemp(prefix="winca_", suffix=".pem")
        with os.fdopen(fd, "w") as fh:
            fh.write("\n".join(pem_blocks))
        os.environ["CURL_CA_BUNDLE"] = path
        os.environ.setdefault("SSL_CERT_FILE", path)
        atexit.register(lambda: os.path.exists(path) and os.remove(path))
        print(f"[http] exported {len(pem_blocks)} Windows certs -> {path}")
    except Exception as exc:
        print(f"[http] Windows cert export skipped: {exc}")


_inject_os_trust_store()
_export_windows_certs_for_curl()


# ---------------------------------------------------------------------------
# Session (Chrome-impersonating curl_cffi, falls back to requests)
# ---------------------------------------------------------------------------

try:
    from curl_cffi import requests as _http
    _SESSION = _http.Session(impersonate="chrome")
    USING_CFFI = True
except Exception as exc:  # pragma: no cover
    import requests as _http
    _SESSION = _http.Session()
    _SESSION.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    USING_CFFI = False
    print(f"[http] curl_cffi unavailable, using plain requests: {exc}")


DEFAULT_TIMEOUT = 15
RETRIES = 2
BACKOFF = 0.6


def _with_retry(do_request):
    last = None
    for attempt in range(RETRIES + 1):
        try:
            r = do_request()
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            last = exc
            if attempt < RETRIES:
                time.sleep(BACKOFF * (2 ** attempt))   # exponential backoff
    raise last


def get_json(url, params=None, timeout=DEFAULT_TIMEOUT):
    return _with_retry(lambda: _SESSION.get(url, params=params, timeout=timeout))


def post_json(url, payload, timeout=DEFAULT_TIMEOUT):
    return _with_retry(lambda: _SESSION.post(url, json=payload, timeout=timeout))
