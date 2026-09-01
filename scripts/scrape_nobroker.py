#!/usr/bin/env python3
"""
Pulls fresh NoBroker rental listings via the Apify actor's public REST API,
filters them down to what FlatFinder cares about, de-dupes against what's
already in the shared Google Sheet, and pushes new ones in.

Why Apify instead of scraping NoBroker directly: NoBroker is a JS-heavy
site and the exact page/API structure couldn't be inspected from the
environment this was built in (network access was blocked there). Apify's
actor is a maintained third party that already solved that problem — this
script just calls its documented run-sync API and stays decoupled from
NoBroker's actual markup.

IMPORTANT — verify before relying on this:
The exact field names Apify's actor returns (title/rent/locality/etc.) were
not directly observed either. FIELD_CANDIDATES below is a best-effort guess
covering common naming conventions. Before trusting this in production:
  1. Run this script once locally with APIFY_TOKEN set and DRY_RUN=1.
  2. Check the printed raw sample item and confirm/adjust FIELD_CANDIDATES
     to match what the actor actually returns.

Required environment variables:
  APIFY_TOKEN       - your Apify API token
  SHEET_API_URL      - the deployed Apps Script Web App URL (see apps-script/Code.gs)
Optional:
  APIFY_ACTOR_ID     - defaults to "parseforge~nobroker-scraper"; verify the
                       correct actor id/slug on the Apify console yourself,
                       this default is a best guess and may be wrong.
  DRY_RUN            - if "1", fetch and print results but don't post/notify
"""

import json
import os
import sys
import urllib.parse
import urllib.request

APIFY_TOKEN = os.environ.get("APIFY_TOKEN", "")
APIFY_ACTOR_ID = os.environ.get("APIFY_ACTOR_ID", "parseforge~nobroker-scraper")
SHEET_API_URL = os.environ.get("SHEET_API_URL", "")
DRY_RUN = os.environ.get("DRY_RUN") == "1"

# Best-guess input for the actor. VERIFY against the actor's own "Input" tab
# on apify.com before relying on this — field names here are a guess.
APIFY_INPUT = {
    "city": "bangalore",
    "localities": ["Hebbal", "Nagawara", "Thanisandra", "HBR Layout", "Jakkur", "Yelahanka"],
    "bhk": [1],
    "propertyType": "rent",
    "maxResults": 50,
}

# Candidate key names for each field we care about, tried in order.
# Apify actor output field names weren't directly observable; adjust this
# list after inspecting a real sample item (see DRY_RUN instructions above).
FIELD_CANDIDATES = {
    "title": ["title", "propertyTitle", "name"],
    "locality": ["locality", "area", "society", "neighbourhood", "locationName"],
    "rent": ["rent", "price", "monthlyRent", "expectedRent"],
    "deposit": ["deposit", "securityDeposit"],
    "bhk": ["bhk", "bedrooms", "numBedrooms"],
    "furnishing": ["furnishing", "furnishingStatus", "furnishingType"],
    "link": ["url", "link", "propertyUrl", "detailUrl"],
    "contact": ["contactName", "ownerName", "postedBy"],
}


def pick(item, field):
    for key in FIELD_CANDIDATES[field]:
        if key in item and item[key] not in (None, ""):
            return item[key]
    return None


def http_json(url, data=None, method="GET"):
    if data is not None:
        body = urllib.parse.urlencode(data).encode() if not isinstance(data, bytes) else data
        req = urllib.request.Request(url, data=body, method=method)
        if isinstance(data, dict):
            req.add_header("Content-Type", "application/x-www-form-urlencoded")
    else:
        req = urllib.request.Request(url, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def fetch_apify_listings():
    url = (
        f"https://api.apify.com/v2/acts/{APIFY_ACTOR_ID}/run-sync-get-dataset-items"
        f"?token={APIFY_TOKEN}"
    )
    req = urllib.request.Request(
        url,
        data=json.dumps(APIFY_INPUT).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.loads(resp.read().decode())


def fetch_existing_links():
    if not SHEET_API_URL:
        return set()
    existing = http_json(SHEET_API_URL)
    return {listing.get("link") for listing in existing if listing.get("link")}


def post_listing(listing):
    body = {
        "title": listing["title"],
        "locality": listing["locality"],
        "distanceKm": "",
        "bhk": listing["bhk"],
        "furnishing": listing.get("furnishing") or "",
        "rent": listing.get("rent") or "",
        "deposit": listing.get("deposit") or "",
        "brokerage": "false",  # NoBroker listings are no-brokerage by definition
        "contact": listing.get("contact") or "",
        "source": "NoBroker (auto)",
        "link": listing["link"],
        "notes": "Auto-imported from NoBroker",
    }
    http_json(SHEET_API_URL, data=body, method="POST")


def main():
    if not APIFY_TOKEN:
        print("APIFY_TOKEN not set, aborting.", file=sys.stderr)
        sys.exit(1)

    raw_items = fetch_apify_listings()
    print(f"Apify returned {len(raw_items)} raw items.")
    if raw_items and DRY_RUN:
        print("Sample raw item (inspect this to fix FIELD_CANDIDATES if needed):")
        print(json.dumps(raw_items[0], indent=2)[:2000])

    normalized = []
    for item in raw_items:
        link = pick(item, "link")
        title = pick(item, "title")
        locality = pick(item, "locality")
        bhk = pick(item, "bhk")
        if not (link and title and locality):
            continue
        normalized.append(
            {
                "title": title,
                "locality": locality,
                "bhk": bhk or 1,
                "furnishing": pick(item, "furnishing"),
                "rent": pick(item, "rent"),
                "deposit": pick(item, "deposit"),
                "contact": pick(item, "contact"),
                "link": link,
            }
        )

    print(f"Normalized {len(normalized)} usable listings.")

    if DRY_RUN:
        print("DRY_RUN=1, not posting or de-duping. Sample normalized listing:")
        if normalized:
            print(json.dumps(normalized[0], indent=2))
        return

    existing_links = fetch_existing_links()
    new_listings = [l for l in normalized if l["link"] not in existing_links]
    print(f"{len(new_listings)} new listings not already in the sheet.")

    for listing in new_listings:
        post_listing(listing)
        print(f"Added: {listing['title']} ({listing['locality']})")


if __name__ == "__main__":
    main()
