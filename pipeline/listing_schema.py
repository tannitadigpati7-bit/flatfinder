"""
The one listing shape every stage of the pipeline and every source connector
agrees on. Sources return RAW listings (original text + a handful of
source-identifying fields); every later stage adds fields to the same dict
and never discards the original raw text.

Nothing here invents data. Every extracted field defaults to None ("UNKNOWN"
once serialized for the UI) and stays None unless something in the raw
listing actually supports a value.
"""

from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any
import hashlib


def make_listing_id(source: str, source_listing_id: str) -> str:
    """Stable id so the same source listing always maps to the same node,
    independent of dict ordering — used as the Firebase key."""
    raw = f"{source}:{source_listing_id}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]


@dataclass
class Listing:
    # --- identity / provenance (required, set by the source connector) ---
    source: str                          # e.g. "NoBroker", "Telegram @HousingBangalore"
    source_listing_id: str               # source's own id, or the URL if none exists
    url: Optional[str] = None            # original listing URL — never fabricated
    title: Optional[str] = None
    raw_text: Optional[str] = None       # full original text, preserved for audit
    image_url: Optional[str] = None      # a real image URL lifted from the source
                                          # post/actor output — never generated,
                                          # never a stock/placeholder photo

    # --- discovery timestamps (ISO 8601 UTC) ---
    first_seen: Optional[str] = None
    last_seen: Optional[str] = None
    last_verified: Optional[str] = None
    source_status: str = "active"        # active | possibly_unavailable | unavailable | not_recently_verified

    # --- extracted fields (EXTRACTION stage fills these; None = UNKNOWN) ---
    bhk: Optional[float] = None
    rent: Optional[float] = None
    deposit: Optional[float] = None
    furnishing: Optional[str] = None     # "semi" | "full" | "none"
    lift: Optional[bool] = None
    brokerage_amount: Optional[float] = None   # 0 if explicitly stated as zero
    brokerage_status: Optional[str] = None     # "zero" | "broker" | None (unknown)
    owner_status: Optional[str] = None         # "owner" | "broker" | None (unknown)
    location: Optional[str] = None             # locality/area text as written
    address: Optional[str] = None              # fuller address if the text has one
    available_from: Optional[str] = None

    # --- GEOCODING stage ---
    lat: Optional[float] = None
    lng: Optional[float] = None
    geocode_source: Optional[str] = None       # "nominatim" | None
    geocode_query: Optional[str] = None        # what text was actually geocoded (audit trail)

    # --- COMMUTE CALCULATION stage ---
    commute_minutes: Optional[float] = None
    commute_source: Optional[str] = None       # "google_distance_matrix_traffic" | "osrm_driving" | None

    # --- HARD FILTERING stage ---
    match_status: str = "needs_verification"   # "confirmed" | "needs_verification" | "rejected"
    fail_reasons: List[str] = field(default_factory=list)   # criteria that are unmet or unknown
    unknown_fields: List[str] = field(default_factory=list)

    # --- DEDUPLICATION stage ---
    dedup_key: Optional[str] = None
    merged_sources: List[Dict[str, str]] = field(default_factory=list)  # [{source, url}]

    # --- SCORING stage ---
    score: Optional[float] = None
    score_reasons: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
