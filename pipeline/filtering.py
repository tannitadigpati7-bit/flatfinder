"""
HARD FILTERING stage.

A listing becomes "confirmed" only if every hard criterion is both known
and satisfied. Any criterion that is UNKNOWN — not merely "not what we
want", but genuinely not determinable from the source — keeps the listing
out of "confirmed" and into "needs_verification" instead. A criterion that
is known and violated makes the listing "rejected".

This is the one place in the whole pipeline that is allowed to decide
match_status — no other stage may write to it, and it is the last stage
before dedup/scoring, so it always runs against fully extracted, geocoded,
commute-computed listings.
"""

from typing import List, Tuple

import config
from listing_schema import Listing

CRITERIA = [
    "bhk",
    "furnishing",
    "rent",
    "deposit",
    "lift",
    "brokerage",
    "commute",
]


def _check_bhk(listing: Listing) -> Tuple[str, str]:
    if listing.bhk is None:
        return "unknown", "bhk: UNKNOWN"
    if listing.bhk != config.REQUIRED_BHK:
        return "fail", f"bhk is {listing.bhk}, need {config.REQUIRED_BHK}"
    return "pass", ""


def _check_furnishing(listing: Listing) -> Tuple[str, str]:
    if listing.furnishing is None:
        return "unknown", "furnishing: UNKNOWN"
    if listing.furnishing != config.REQUIRED_FURNISHING:
        return "fail", f"furnishing is {listing.furnishing}, need {config.REQUIRED_FURNISHING}"
    return "pass", ""


def _check_rent(listing: Listing) -> Tuple[str, str]:
    if listing.rent is None:
        return "unknown", "rent: UNKNOWN"
    if listing.rent > config.MAX_RENT:
        return "fail", f"rent ₹{listing.rent:,.0f} exceeds ₹{config.MAX_RENT:,}"
    return "pass", ""


def _check_deposit(listing: Listing) -> Tuple[str, str]:
    if listing.deposit is None:
        return "unknown", "deposit: UNKNOWN"
    if listing.deposit > config.MAX_DEPOSIT:
        return "fail", f"deposit ₹{listing.deposit:,.0f} exceeds ₹{config.MAX_DEPOSIT:,}"
    return "pass", ""


def _check_lift(listing: Listing) -> Tuple[str, str]:
    if listing.lift is None:
        return "unknown", "lift: UNKNOWN"
    if listing.lift is not True:
        return "fail", "no lift"
    return "pass", ""


def _check_brokerage(listing: Listing) -> Tuple[str, str]:
    if listing.brokerage_status is None:
        return "unknown", "brokerage: UNKNOWN"
    if listing.brokerage_status != "zero":
        return "fail", "brokerage applies"
    return "pass", ""


def _check_commute(listing: Listing) -> Tuple[str, str]:
    if listing.commute_minutes is None:
        return "unknown", "commute: UNKNOWN (not geocoded/routed)"
    if listing.commute_minutes > config.MAX_COMMUTE_MINUTES:
        return "fail", f"commute {listing.commute_minutes:.0f} min exceeds {config.MAX_COMMUTE_MINUTES} min"
    return "pass", ""


_CHECKS = {
    "bhk": _check_bhk,
    "furnishing": _check_furnishing,
    "rent": _check_rent,
    "deposit": _check_deposit,
    "lift": _check_lift,
    "brokerage": _check_brokerage,
    "commute": _check_commute,
}


def apply_hard_filter(listing: Listing) -> Listing:
    fail_reasons: List[str] = []
    unknown_fields: List[str] = []
    any_fail = False
    any_unknown = False

    for name in CRITERIA:
        result, message = _CHECKS[name](listing)
        if result == "fail":
            any_fail = True
            fail_reasons.append(message)
        elif result == "unknown":
            any_unknown = True
            unknown_fields.append(name)

    listing.fail_reasons = fail_reasons
    listing.unknown_fields = unknown_fields

    if any_fail:
        listing.match_status = "rejected"
    elif any_unknown:
        listing.match_status = "needs_verification"
    else:
        listing.match_status = "confirmed"

    return listing
