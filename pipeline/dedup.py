"""
DEDUPLICATION stage.

The same physical flat is often posted on more than one site (an owner
posts to NoBroker and also drops the same text into a Telegram channel).
This groups listings that are very likely the same property and merges
them into one record that keeps every source URL, rather than showing
near-identical cards twice.

Matching signal, in order of strength:
  1. Same phone/WhatsApp contact number extracted from the text.
  2. Same geocoded coordinates (within ~60m) AND same rent AND same BHK.
  3. Same rent + same deposit + same BHK + fuzzy-matching location text.

This is deliberately conservative — two listings are merged only when
multiple independent signals agree, because merging two genuinely
different flats would hide a real option from the confirmed list.
"""

import math
import re
from difflib import SequenceMatcher
from typing import List

from listing_schema import Listing

PHONE_DIGITS_RE = re.compile(r"\d{10}")


def _extract_phone_digits(contact_text: str):
    if not contact_text:
        return None
    m = PHONE_DIGITS_RE.search(contact_text)
    return m.group(0) if m else None


def _normalize_location(text: str) -> str:
    if not text:
        return ""
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _haversine_m(lat1, lng1, lat2, lng2) -> float:
    r = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(min(1, math.sqrt(a)))


def _same_property(a: Listing, b: Listing) -> bool:
    phone_a = _extract_phone_digits(a.raw_text or "")
    phone_b = _extract_phone_digits(b.raw_text or "")
    if phone_a and phone_b and phone_a == phone_b:
        return True

    if (
        a.lat is not None and a.lng is not None and b.lat is not None and b.lng is not None
        and a.rent is not None and b.rent is not None and a.rent == b.rent
        and a.bhk is not None and b.bhk is not None and a.bhk == b.bhk
    ):
        if _haversine_m(a.lat, a.lng, b.lat, b.lng) <= 60:
            return True

    if (
        a.rent is not None and b.rent is not None and a.rent == b.rent
        and a.deposit is not None and b.deposit is not None and a.deposit == b.deposit
        and a.bhk is not None and b.bhk is not None and a.bhk == b.bhk
    ):
        loc_a, loc_b = _normalize_location(a.location or ""), _normalize_location(b.location or "")
        if loc_a and loc_b:
            similarity = SequenceMatcher(None, loc_a, loc_b).ratio()
            if similarity >= 0.6:
                return True

    return False


def deduplicate(listings: List[Listing]) -> List[Listing]:
    """Groups matching listings and merges each group into its
    highest-information member (most non-None fields), keeping every
    source URL under merged_sources."""
    groups: List[List[Listing]] = []
    for listing in listings:
        placed = False
        for group in groups:
            if any(_same_property(listing, other) for other in group):
                group.append(listing)
                placed = True
                break
        if not placed:
            groups.append([listing])

    merged: List[Listing] = []
    for group in groups:
        if len(group) == 1:
            merged.append(group[0])
            continue

        def info_score(l: Listing) -> int:
            return sum(1 for v in l.to_dict().values() if v not in (None, "", []))

        primary = max(group, key=info_score)
        primary.merged_sources = [
            {"source": l.source, "url": l.url or ""} for l in group
        ]
        merged.append(primary)

    return merged
