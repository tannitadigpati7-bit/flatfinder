#!/usr/bin/env python3
"""
Pipeline orchestrator — runs every stage in order:

  DISCOVERY -> RAW STORAGE (freshness merge) -> EXTRACTION -> VALIDATION
  -> GEOCODING -> COMMUTE CALCULATION -> HARD FILTERING -> DEDUPLICATION
  -> SCORING -> STORE

Run with: python pipeline/run.py [--dry-run]

Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (unless --dry-run).
GOOGLE_MAPS_API_KEY and Apify env vars are optional — the pipeline runs and
is honest about what it couldn't compute without them (see commute.py,
sources/apify_generic.py).
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config
import extraction
import validation
import geocode
import commute
import filtering
import dedup
import scoring
import store
from listing_schema import Listing
from sources.telegram_public import TelegramPublicSource
from sources.apify_generic import ApifyGenericSource


def build_sources():
    return [
        TelegramPublicSource(),
        ApifyGenericSource(),
    ]


def run(dry_run: bool = False) -> int:
    all_raw = []
    for source in build_sources():
        try:
            found = source.discover()
        except Exception as err:  # one source failing must not kill the run
            print(f"[run] source '{source.name}' failed entirely: {err}")
            continue
        print(f"[run] {source.name}: {len(found)} raw listing(s) discovered")
        all_raw.extend(found)

    print(f"[run] {len(all_raw)} total raw listings across all sources")

    # EXTRACTION + VALIDATION
    for listing in all_raw:
        extraction.extract_fields(listing)
        validation.validate_fields(listing)

    # GEOCODING
    geo_session = geocode.GeocodeSession()
    office_coords = geo_session.geocode_office()
    if office_coords is None:
        print(
            "[run] WARNING: could not geocode the office address "
            f"({config.OFFICE_ADDRESS!r}). Every listing's commute will be UNKNOWN this run."
        )

    for listing in all_raw:
        query_text = listing.address or listing.location
        if query_text:
            listing.geocode_query = query_text
            coords = geo_session.geocode(query_text)
            if coords:
                listing.lat, listing.lng = coords
                listing.geocode_source = "nominatim"
    geo_session.save()

    # COMMUTE CALCULATION
    commute_session = commute.CommuteSession()
    if office_coords:
        for listing in all_raw:
            if listing.lat is not None and listing.lng is not None:
                minutes, source = commute_session.commute_minutes(
                    (listing.lat, listing.lng), office_coords
                )
                listing.commute_minutes = minutes
                listing.commute_source = source
    commute_session.save()

    # HARD FILTERING
    for listing in all_raw:
        filtering.apply_hard_filter(listing)

    # DEDUPLICATION
    deduped = dedup.deduplicate(all_raw)
    print(f"[run] {len(deduped)} listings after deduplication (from {len(all_raw)})")

    confirmed = sum(1 for l in deduped if l.match_status == "confirmed")
    needs_verification = sum(1 for l in deduped if l.match_status == "needs_verification")
    rejected = sum(1 for l in deduped if l.match_status == "rejected")
    print(f"[run] confirmed={confirmed} needs_verification={needs_verification} rejected={rejected}")

    if dry_run:
        print("[run] --dry-run set, not writing to Firebase. Sample confirmed listing:")
        for l in deduped:
            if l.match_status == "confirmed":
                import json
                print(json.dumps(l.to_dict(), indent=2, ensure_ascii=False, default=str))
                break
        else:
            print("(none confirmed this run)")
        return 0

    if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_ROLE_KEY:
        print("[run] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — nothing to write to. Aborting.", file=sys.stderr)
        return 1

    # RAW STORAGE freshness merge (first_seen/last_seen/source_status)
    existing = store.fetch_all()
    merged = store.merge_with_existing(deduped, existing)
    carried_forward = store.carry_forward_missing(deduped, existing)

    # SCORING (confirmed-only ranking; carried-forward listings keep
    # whatever match_status/score they last had computed)
    scoring.rank_confirmed(merged)

    final = merged + carried_forward
    store.save_all(final)
    print(f"[run] saved {len(final)} listings to Firebase ({len(carried_forward)} carried forward unchanged)")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    sys.exit(run(dry_run=args.dry_run))
