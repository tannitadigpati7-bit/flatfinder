"""
DISCOVERY source: any site reachable through a maintained third-party
Apify actor (NoBroker, Housing, 99acres, MagicBricks all fall in this
bucket — none publish a public API, and their pages are JS-heavy with
anti-bot protection, so a from-scratch scraper here would either break
immediately or need to defeat protections this project won't defeat).

This is deliberately generic and driven entirely by environment
configuration rather than one hardcoded actor per site, because the exact
actor id and its output field names cannot be verified from this
environment (no live network access while building this) — see README
for the verification steps you must do once, per site, before trusting
its output. Until verified, treat this source's listings as
needs_verification even where the hard filter would otherwise confirm
them (see run.py).

Configuration (all via environment variables, one set per site):
  APIFY_TOKEN                  - shared Apify API token
  APIFY_SITE_<NAME>_ACTOR_ID   - e.g. APIFY_SITE_NOBROKER_ACTOR_ID
  APIFY_SITE_<NAME>_INPUT      - JSON string, actor-specific input
Sites to run are named in APIFY_SITES (comma-separated, e.g.
"nobroker,housing,99acres,magicbricks"); a site with no actor id
configured is skipped, not guessed at.
"""

import json
import os
import urllib.error
import urllib.request
from typing import List

from listing_schema import Listing
from sources.base import Source

import config

# Candidate key names tried in order for each field — actor output field
# names vary and were not directly observable while building this; adjust
# per-site if verification (see README) finds different names.
FIELD_CANDIDATES = {
    "title": ["title", "propertyTitle", "name", "heading"],
    "url": ["url", "link", "propertyUrl", "detailUrl"],
    "raw_text": ["description", "propertyDescription", "details", "fullDescription"],
    "location": ["locality", "area", "society", "neighbourhood", "locationName"],
    "address": ["address", "fullAddress"],
    "rent": ["rent", "price", "monthlyRent", "expectedRent"],
    "deposit": ["deposit", "securityDeposit"],
    "bhk": ["bhk", "bedrooms", "numBedrooms"],
    "furnishing": ["furnishing", "furnishingStatus", "furnishingType"],
    "lift": ["lift", "hasLift", "elevator"],
    "brokerage": ["brokerage", "brokerageAmount"],
    "ownerStatus": ["postedBy", "listedBy", "sourceType"],
    "contact": ["contactName", "ownerName", "postedByName"],
    "id": ["id", "propertyId", "listingId"],
}


def _pick(item: dict, field: str):
    for key in FIELD_CANDIDATES[field]:
        if key in item and item[key] not in (None, ""):
            return item[key]
    return None


class ApifySite:
    def __init__(self, site_name: str, actor_id: str, actor_input: dict):
        self.site_name = site_name
        self.actor_id = actor_id
        self.actor_input = actor_input


def _configured_sites() -> List[ApifySite]:
    names = [s.strip() for s in os.environ.get("APIFY_SITES", "").split(",") if s.strip()]
    sites = []
    for name in names:
        env_prefix = f"APIFY_SITE_{name.upper()}"
        actor_id = os.environ.get(f"{env_prefix}_ACTOR_ID", "")
        if not actor_id:
            print(f"[apify_generic] no actor id configured for site '{name}' — skipping (see README).")
            continue
        raw_input = os.environ.get(f"{env_prefix}_INPUT", "{}")
        try:
            actor_input = json.loads(raw_input)
        except json.JSONDecodeError:
            print(f"[apify_generic] {env_prefix}_INPUT is not valid JSON — skipping '{name}'.")
            continue
        sites.append(ApifySite(name, actor_id, actor_input))
    return sites


class ApifyGenericSource(Source):
    name = "apify_generic"

    def __init__(self):
        self.sites = _configured_sites()

    def _run_actor(self, site: ApifySite) -> List[dict]:
        url = (
            f"https://api.apify.com/v2/acts/{site.actor_id}/run-sync-get-dataset-items"
            f"?token={config.APIFY_TOKEN}"
        )
        req = urllib.request.Request(
            url,
            data=json.dumps(site.actor_input).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def discover(self) -> List[Listing]:
        if not config.APIFY_TOKEN or not self.sites:
            return []

        listings: List[Listing] = []
        for site in self.sites:
            try:
                raw_items = self._run_actor(site)
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as err:
                print(f"[apify_generic] {site.site_name} run failed: {err}")
                continue

            print(f"[apify_generic] {site.site_name}: {len(raw_items)} raw item(s) from the actor")
            if raw_items:
                # This actor's real output field names weren't verified before
                # writing FIELD_CANDIDATES above (no way to inspect the Apify
                # Store page from this environment) — print one real sample
                # so a human can check/fix FIELD_CANDIDATES against what the
                # actor actually returns, same as the old scrape_nobroker.py
                # script's DRY_RUN mode did.
                print(f"[apify_generic] {site.site_name} sample raw item (verify FIELD_CANDIDATES against this):")
                print(json.dumps(raw_items[0], indent=2, ensure_ascii=False, default=str)[:3000])

            for item in raw_items:
                url = _pick(item, "url")
                source_id = _pick(item, "id") or url
                if not url or not source_id:
                    continue  # can't provenance-track this item, skip rather than fabricate an id

                owner_status = None
                posted_by = _pick(item, "ownerStatus")
                if isinstance(posted_by, str):
                    lowered = posted_by.lower()
                    if "owner" in lowered:
                        owner_status = "owner"
                    elif "broker" in lowered or "agent" in lowered:
                        owner_status = "broker"

                lift = None
                lift_raw = _pick(item, "lift")
                if isinstance(lift_raw, bool):
                    lift = lift_raw
                elif isinstance(lift_raw, str):
                    lift = lift_raw.strip().lower() in ("yes", "true", "available")

                brokerage_amount = _pick(item, "brokerage")
                brokerage_status = None
                if brokerage_amount is not None:
                    try:
                        brokerage_status = "zero" if float(brokerage_amount) == 0 else "broker"
                        brokerage_amount = float(brokerage_amount)
                    except (TypeError, ValueError):
                        brokerage_amount = None

                listings.append(Listing(
                    source=site.site_name,
                    source_listing_id=str(source_id),
                    url=url,
                    title=_pick(item, "title"),
                    raw_text=_pick(item, "raw_text") or _pick(item, "title") or "",
                    location=_pick(item, "location"),
                    address=_pick(item, "address"),
                    rent=_safe_float(_pick(item, "rent")),
                    deposit=_safe_float(_pick(item, "deposit")),
                    bhk=_safe_float(_pick(item, "bhk")),
                    furnishing=_normalize_furnishing(_pick(item, "furnishing")),
                    lift=lift,
                    brokerage_amount=brokerage_amount,
                    brokerage_status=brokerage_status,
                    owner_status=owner_status,
                ))
        return listings


def _safe_float(value):
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_furnishing(value):
    if not isinstance(value, str):
        return None
    lowered = value.strip().lower()
    if "semi" in lowered:
        return "semi"
    if "full" in lowered:
        return "full"
    if "unfurnish" in lowered or "none" in lowered or "bare" in lowered:
        return "none"
    return None
