"""
VALIDATION stage.

Sanity-bounds extracted values so an obvious mis-parse doesn't silently
survive into filtering/scoring as if it were real. A value outside its
plausible range is treated as UNKNOWN (None) rather than kept — under-
confident but correct beats over-confident and wrong for a hard filter
someone is going to actually act on.
"""

from listing_schema import Listing

BHK_RANGE = (0.5, 6)
RENT_RANGE = (1000, 500000)          # INR/month
DEPOSIT_RANGE = (0, 5000000)          # INR
COMMUTE_RANGE = (0, 240)              # minutes


def _clamp_or_none(value, low, high):
    if value is None:
        return None
    return value if low <= value <= high else None


def validate_fields(listing: Listing) -> Listing:
    listing.bhk = _clamp_or_none(listing.bhk, *BHK_RANGE)
    listing.rent = _clamp_or_none(listing.rent, *RENT_RANGE)
    listing.deposit = _clamp_or_none(listing.deposit, *DEPOSIT_RANGE)
    listing.commute_minutes = _clamp_or_none(listing.commute_minutes, *COMMUTE_RANGE)

    if listing.furnishing not in ("semi", "full", "none", None):
        listing.furnishing = None
    if listing.brokerage_status not in ("zero", "broker", None):
        listing.brokerage_status = None
    if listing.owner_status not in ("owner", "broker", None):
        listing.owner_status = None

    return listing
