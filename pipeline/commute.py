"""
COMMUTE CALCULATION stage.

Computes an actual estimated travel time from a listing's geocoded
coordinates to the fixed office destination — never a straight-line
distance standing in for travel time.

Two providers, tried in this order:

1. Google Distance Matrix API (traffic-aware) — used only when
   GOOGLE_MAPS_API_KEY is configured. Calls with mode=driving,
   departure_time=now and traffic_model=best_guess, so the result reflects
   Bangalore traffic conditions at request time, per the project spec.
   This is a paid Google Cloud API (a monthly free credit typically covers
   personal-scale usage, but it does require billing enabled on the
   project) — see README for setup.

2. OSRM's public routing server (router.project-osrm.org) — free, no
   account needed, real road-network driving time. It has NO live traffic
   model, so its numbers are a floor on actual travel time during
   Bangalore traffic, not an accurate estimate of it. Every listing
   records which provider produced its commute_minutes via
   `commute_source`, so the UI/filter can be honest about which listings
   have traffic-aware numbers and which don't.

If both fail (no key, no network, no route found), commute_minutes stays
None — the listing is UNKNOWN on this hard criterion, not passed.
"""

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional, Tuple

import config

_last_osrm_ts = 0.0
_OSRM_MIN_INTERVAL = 1.0  # be polite to the free public OSRM demo server


def _load_cache() -> dict:
    if not os.path.exists(config.COMMUTE_CACHE_PATH):
        return {}
    try:
        with open(config.COMMUTE_CACHE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _save_cache(cache: dict) -> None:
    os.makedirs(config.CACHE_DIR, exist_ok=True)
    with open(config.COMMUTE_CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, sort_keys=True)


def _cache_key(origin: Tuple[float, float], dest: Tuple[float, float]) -> str:
    # Round to ~11m precision — enough to dedupe repeat geocodes of the same
    # building without conflating genuinely different addresses.
    return f"{origin[0]:.4f},{origin[1]:.4f}->{dest[0]:.4f},{dest[1]:.4f}"


def _google_distance_matrix(origin, dest) -> Optional[float]:
    if not config.GOOGLE_MAPS_API_KEY:
        return None
    params = urllib.parse.urlencode({
        "origins": f"{origin[0]},{origin[1]}",
        "destinations": f"{dest[0]},{dest[1]}",
        "mode": "driving",
        "departure_time": "now",
        "traffic_model": "best_guess",
        "key": config.GOOGLE_MAPS_API_KEY,
    })
    url = f"https://maps.googleapis.com/maps/api/distancematrix/json?{params}"
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None

    if data.get("status") != "OK":
        return None
    try:
        element = data["rows"][0]["elements"][0]
    except (IndexError, KeyError):
        return None
    if element.get("status") != "OK":
        return None

    duration_seconds = (
        element.get("duration_in_traffic", {}).get("value")
        if "duration_in_traffic" in element
        else element.get("duration", {}).get("value")
    )
    if duration_seconds is None:
        return None
    return duration_seconds / 60.0


def _osrm_driving(origin, dest) -> Optional[float]:
    global _last_osrm_ts
    elapsed = time.monotonic() - _last_osrm_ts
    if elapsed < _OSRM_MIN_INTERVAL:
        time.sleep(_OSRM_MIN_INTERVAL - elapsed)
    _last_osrm_ts = time.monotonic()

    # OSRM wants lng,lat order.
    coords = f"{origin[1]},{origin[0]};{dest[1]},{dest[0]}"
    url = f"https://router.project-osrm.org/route/v1/driving/{coords}?overview=false"
    req = urllib.request.Request(url, headers={"User-Agent": config.NOMINATIM_USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None

    if data.get("code") != "Ok" or not data.get("routes"):
        return None
    duration_seconds = data["routes"][0]["duration"]
    return duration_seconds / 60.0


def commute_minutes(origin: Tuple[float, float], dest: Tuple[float, float], cache: Optional[dict] = None):
    """Returns (minutes, source) where source is
    "google_distance_matrix_traffic" | "osrm_driving" | None.
    (None, None) means it could not be computed — treat as UNKNOWN."""
    owns_cache = cache is None
    if owns_cache:
        cache = _load_cache()

    key = _cache_key(origin, dest)
    if key in cache:
        entry = cache[key]
        return (entry["minutes"], entry["source"]) if entry else (None, None)

    minutes = _google_distance_matrix(origin, dest)
    source = "google_distance_matrix_traffic" if minutes is not None else None

    if minutes is None:
        minutes = _osrm_driving(origin, dest)
        source = "osrm_driving" if minutes is not None else None

    cache[key] = {"minutes": minutes, "source": source} if minutes is not None else None
    if owns_cache:
        _save_cache(cache)
    return (minutes, source)


class CommuteSession:
    def __init__(self):
        self.cache = _load_cache()

    def commute_minutes(self, origin, dest):
        return commute_minutes(origin, dest, cache=self.cache)

    def save(self) -> None:
        _save_cache(self.cache)
