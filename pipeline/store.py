"""
RAW DATA STORAGE + freshness tracking, backed by Supabase (Postgres via
PostgREST — see supabase/schema.sql for the table this reads/writes).
Uses the service_role key so the scheduled pipeline can write regardless of
the row-level-security policies that gate the public anon key used by the
browser (site, extension, mobile share target) — see schema.sql's comments
for exactly what each key is and isn't allowed to do.

Listings are upserted per-row on the (source, source_listing_id) unique
constraint rather than the old Firebase approach of overwriting the entire
collection on every save — a run that discovers 40 listings no longer risks
clobbering rows a concurrent manual capture just added.

Freshness model (see FRESHNESS in the project spec):
  first_seen       - set once, on first write, never overwritten.
  last_seen        - updated every time this run's discovery re-found it.
  last_verified    - updated only when a source connector actually
                      confirms the listing still exists, not merely
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

LISTINGS_ENDPOINT = "/rest/v1/listings"


def _supabase_request(path: str, method: str = "GET", data=None, extra_headers=None):
    if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured.")
    url = f"{config.SUPABASE_URL.rstrip('/')}{path}"
    headers = {
        "apikey": config.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {config.SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)

    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        # PostgREST's actual error (missing column, check-constraint
        # violation, bad on_conflict target, etc.) is in the response
        # body — the bare HTTPError code/reason alone isn't enough to
        # diagnose a 400 from a batch of 30+ rows.
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase {method} {path} -> HTTP {e.code}: {detail}") from e


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
    """Loads every stored listing, keyed by an in-memory
    (source, source_listing_id) id — this key never touches the database,
    it's just how this module tracks "have we seen this before" across a
    run. Returns {} rather than raising if Supabase isn't configured or
    unreachable, so a first-ever run with an empty table behaves the same
    as a network hiccup: nothing to merge against, not a fatal error."""
    if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_ROLE_KEY:
        return {}
    try:
        rows = _supabase_request(f"{LISTINGS_ENDPOINT}?select=*") or []
    except (urllib.error.URLError, TimeoutError, RuntimeError):
        return {}

    out: Dict[str, Listing] = {}
    known_fields = {f for f in Listing.__dataclass_fields__}
    for row in rows:
        fields = {k: v for k, v in row.items() if k in known_fields}
        try:
            out[make_listing_id(fields.get("source", ""), fields.get("source_listing_id", ""))] = Listing(**fields)
        except TypeError:
            continue  # a row shaped by an older schema version — skip, don't crash the run
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
    """Upserts every listing in one batched request, keyed on the
    (source, source_listing_id) unique constraint — see schema.sql. Rows
    for other listings already in the table (including ones the browser
    added via manual capture) are left untouched; this never wipes the
    table the way the old Firebase full-collection PUT did."""
    if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured — nothing to save to.")
    if not listings:
        return

    payload = [listing.to_dict() for listing in listings]
    _supabase_request(
        f"{LISTINGS_ENDPOINT}?on_conflict=source,source_listing_id",
        method="POST",
        data=payload,
        extra_headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
    )
