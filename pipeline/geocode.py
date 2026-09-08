"""
GEOCODING stage.

Turns free-text location/address into (lat, lng) using OpenStreetMap's
Nominatim — a free, public geocoder with a usage policy this module
respects: a real User-Agent, <=1 request/second, and a local disk cache so
the same string is never geocoded twice.

If a listing's location text can't be geocoded (Nominatim finds nothing,
or the listing has no location text at all), lat/lng stay None. Nothing
downstream is allowed to guess coordinates for a listing that failed here —
its commute is then UNKNOWN, not estimated.
"""

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional, Tuple

import config

_last_request_ts = 0.0
_MIN_INTERVAL_SECONDS = 1.05  # Nominatim usage policy: max 1 req/sec


def _load_cache() -> dict:
    if not os.path.exists(config.GEOCODE_CACHE_PATH):
        return {}
    try:
        with open(config.GEOCODE_CACHE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _save_cache(cache: dict) -> None:
    os.makedirs(config.CACHE_DIR, exist_ok=True)
    with open(config.GEOCODE_CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, sort_keys=True)


def _rate_limit() -> None:
    global _last_request_ts
    elapsed = time.monotonic() - _last_request_ts
    if elapsed < _MIN_INTERVAL_SECONDS:
        time.sleep(_MIN_INTERVAL_SECONDS - elapsed)
    _last_request_ts = time.monotonic()


def geocode(query_text: str, cache: Optional[dict] = None) -> Optional[Tuple[float, float]]:
    """Returns (lat, lng) or None if the address couldn't be resolved.
    `cache` may be passed in to batch many lookups under one load/save."""
    if not query_text or not query_text.strip():
        return None

    owns_cache = cache is None
    if owns_cache:
        cache = _load_cache()

    key = query_text.strip().lower()
    if key in cache:
        cached = cache[key]
        result = tuple(cached) if cached else None
        if owns_cache:
            pass  # nothing to persist, we just read
        return result

    # Bias toward Bangalore since every query here is a Bangalore rental
    # listing's location text, which is often just a bare locality name.
    search_text = query_text if "bangalore" in key or "bengaluru" in key else f"{query_text}, Bangalore, India"

    params = urllib.parse.urlencode({
        "q": search_text,
        "format": "jsonv2",
        "limit": 1,
        "countrycodes": "in",
    })
    url = f"https://nominatim.openstreetmap.org/search?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": config.NOMINATIM_USER_AGENT})

    _rate_limit()
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            results = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        # Network/service failure -> unknown, not a guess. Don't cache
        # transient failures so a later run can retry.
        return None

    if not results:
        cache[key] = None
        if owns_cache:
            _save_cache(cache)
        return None

    lat = float(results[0]["lat"])
    lng = float(results[0]["lon"])
    cache[key] = [lat, lng]
    if owns_cache:
        _save_cache(cache)
    return (lat, lng)


def geocode_office(cache: Optional[dict] = None) -> Optional[Tuple[float, float]]:
    """Geocodes the fixed office destination — computed the same way as any
    listing's location, never hardcoded, so it's auditable against the same
    cache file.

    A small company's office name is often not a named point of interest in
    OpenStreetMap's database, so the full address can legitimately return no
    match even though the street/neighbourhood does. Falls back through
    progressively broader *real* substrings of the same configured address
    (never a different, invented address) until one resolves — the office
    still ends up wherever Vasanth Nagar/Bangalore actually is, just without
    a hit on the specific building name."""
    candidates = [config.OFFICE_ADDRESS]
    parts = [p.strip() for p in config.OFFICE_ADDRESS.split(",") if p.strip()]
    for i in range(1, len(parts)):
        candidates.append(", ".join(parts[i:]))

    for query in candidates:
        result = geocode(query, cache=cache)
        if result is not None:
            return result
    return None


class GeocodeSession:
    """Batches geocode() calls under one cache load/save — use this in the
    pipeline runner instead of calling geocode() directly per listing."""

    def __init__(self):
        self.cache = _load_cache()

    def geocode(self, query_text: str) -> Optional[Tuple[float, float]]:
        return geocode(query_text, cache=self.cache)

    def geocode_office(self) -> Optional[Tuple[float, float]]:
        return geocode_office(cache=self.cache)

    def save(self) -> None:
        _save_cache(self.cache)
