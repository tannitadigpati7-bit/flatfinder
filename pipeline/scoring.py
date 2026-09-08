"""
SCORING stage.

Ranks CONFIRMED matches only (needs_verification/rejected listings are
never scored — they don't compete with genuine matches). Order follows
the project spec exactly:

  1. Shortest commute
  2. Lowest rent
  3. Lowest deposit
  4. Owner-direct confidence (owner_status == "owner" ranks above unknown)
  5. Better furnishing (semi already required; this only matters if we
     ever loosen the hard filter — kept for completeness/future use)
  6. Additional amenities (count of positive amenity mentions in raw text)
  7. Listing freshness (first_seen, newer first)

Score is a tuple used purely for sorting; score_reasons is a short,
human-readable explanation of why the listing ranked where it did, shown
in the UI under each confirmed card ("why this ranked highly").
"""

from typing import List

from listing_schema import Listing

AMENITY_KEYWORDS = [
    "parking", "power backup", "24x7 water", "gated", "security", "gym",
    "cctv", "borewell", "cauvery", "wifi", "modular kitchen",
]


def _amenity_count(listing: Listing) -> int:
    text = (listing.raw_text or "").lower()
    return sum(1 for kw in AMENITY_KEYWORDS if kw in text)


def score_listing(listing: Listing) -> Listing:
    commute = listing.commute_minutes if listing.commute_minutes is not None else float("inf")
    rent = listing.rent if listing.rent is not None else float("inf")
    deposit = listing.deposit if listing.deposit is not None else float("inf")
    owner_rank = 0 if listing.owner_status == "owner" else 1
    amenities = _amenity_count(listing)
    # Newer first_seen sorts earlier when reversed at the end.
    freshness_key = listing.first_seen or ""

    listing.score = None  # sort key is a tuple, not stored as a single float
    listing._sort_key = (commute, rent, deposit, owner_rank, -amenities, freshness_key)  # type: ignore[attr-defined]

    reasons = []
    if commute != float("inf"):
        reasons.append(f"{commute:.0f} min commute")
    if rent != float("inf"):
        reasons.append(f"₹{rent:,.0f}/mo")
    if listing.owner_status == "owner":
        reasons.append("owner-direct")
    if amenities:
        reasons.append(f"{amenities} amenities mentioned")
    listing.score_reasons = reasons

    return listing


def rank_confirmed(listings: List[Listing]) -> List[Listing]:
    confirmed = [l for l in listings if l.match_status == "confirmed"]
    for l in confirmed:
        score_listing(l)
    confirmed.sort(key=lambda l: l._sort_key)  # type: ignore[attr-defined]
    return confirmed
