"""
RAW DATA STORAGE + freshness tracking, backed by the same Firebase Realtime
Database the site already uses (see README > "Setting up the shared
backend"). Nothing here is a new backend — it's the persistence layer the
rest of the pipeline reads/writes through, keyed by a stable id derived
from (source, source_listing_id) so re-discovering the same listing
updates it in place instead of duplicating it.

Freshness model (see FRESHNESS in the project spec):
  first_seen       - set once, on first write, never overwritten.
  last_seen        - updated every time this run's discovery re-found it.
  last_verified    - updated only when a source connector actually
                      confirms the listing still exists (e.g. re-fetched
                      its detail page and it still resolves), not merely
                      because a pipeline run happened.
  source_status    - derived from how long it's been since last_seen /
                      last_verified (see _derive_status below); a listing
                      that stops showing up in discovery ages toward
                      "possibly_unavailable" and then "unavailable"
                      automatically, it never needs a person to mark it.
"""

import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Dict, List

import config
from listing_schema import Listing, make_listing_id


def _http_json(url: str, data=None, method: str = "GET"):
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("Content-Type", "application/json")
    else:
        req = urllib.request.Request(url, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _derive_status(last_seen_iso: str, last_verified_iso: str) -> str:
    now = datetime.now(timezone.utc)

    def hours_since(iso_str: str) -> float:
        try:
            dt = datetime.fromisoformat(iso_str)
        except (TypeError, ValueError):
            return float("inf")
        return (now - dt).total_seconds() / 3600.0

    seen_hours = hours_since(last_seen_iso)
    verified_hours = hours_since(last_verified_iso)

    if seen_hours > config.POSSIBLY_UNAVAILABLE_AFTER_HOURS:
        return "unavailable"
    if seen_hours > config.VERIFY_STALE_AFTER_HOURS:
        return "possibly_unavailable"
    if verified_hours > config.VERIFY_STALE_AFTER_HOURS:
        return "not_recently_verified"
    return "active"


def fetch_all() -> Dict[str, Listing]:
    """Loads every stored listing keyed by its stable id."""
    if not config.FIREBASE_DB_URL:
        return {}
    try:
        raw = _http_json(f"{config.FIREBASE_DB_URL}/pipeline_listings.json") or {}
    except (urllib.error.URLError, TimeoutError):
        return {}

    out: Dict[str, Listing] = {}
    for key, fields in raw.items():
        try:
            out[key] = Listing(**fields)
        except TypeError:
            # A stored record with a shape from an older schema version —
            # skip rather than crash the whole run on one bad record.
            continue
    return out


def merge_with_existing(fresh: List[Listing], existing: Dict[str, Listing]) -> List[Listing]:
    """Applies freshness bookkeeping: a listing discovered again keeps its
    original first_seen and gets a bumped last_seen; a brand-new listing
    gets first_seen = last_seen = now."""
    ts = now_iso()
    merged: List[Listing] = []

    for listing in fresh:
        key = make_listing_id(listing.source, listing.source_listing_id)
        prior = existing.get(key)
        if prior:
            listing.first_seen = prior.first_seen or ts
            listing.last_verified = prior.last_verified or ts
        else:
            listing.first_seen = ts
            listing.last_verified = ts
        listing.last_seen = ts
        listing.source_status = _derive_status(listing.last_seen, listing.last_verified)
        merged.append(listing)

    return merged


def carry_forward_missing(fresh: List[Listing], existing: Dict[str, Listing]) -> List[Listing]:
    """Listings that were stored before but weren't re-discovered this run
    still belong in the store (they might just be off this run's source
    pages, e.g. a Telegram channel's recent-messages window) — carried
    forward unchanged except for a freshly derived source_status so they
    age toward possibly_unavailable/unavailable on their own."""
    fresh_keys = {make_listing_id(l.source, l.source_listing_id) for l in fresh}
    carried = []
    for key, listing in existing.items():
        if key in fresh_keys:
            continue
        listing.source_status = _derive_status(listing.last_seen, listing.last_verified)
        carried.append(listing)
    return carried


def save_all(listings: List[Listing]) -> None:
    if not config.FIREBASE_DB_URL:
        raise RuntimeError("FIREBASE_DB_URL is not configured — nothing to save to.")
    payload = {}
    for listing in listings:
        key = make_listing_id(listing.source, listing.source_listing_id)
        payload[key] = listing.to_dict()
    _http_json(f"{config.FIREBASE_DB_URL}/pipeline_listings.json", data=payload, method="PUT")
