"""
EXTRACTION stage.

Deterministic regex/keyword parsing of raw listing text into structured
fields. This is intentionally conservative: every function returns None
(-> "UNKNOWN" in the UI) when the text doesn't clearly support a value,
rather than guessing. In particular:

  - Missing lift mention  -> lift = None, never True.
  - Missing brokerage mention -> brokerage_status = None, never "zero".
  - Missing owner/broker mention -> owner_status = None, never "owner".

A small, optional LLM-assisted pass (llm_extract.py) can be layered on top
for listings where the regex pass leaves fields unknown — see that module.
It never overrides a value the regex pass is confident about, and it still
cannot turn "unknown" into a hard-filter pass; see filtering.py.
"""

import re
from typing import Optional

from listing_schema import Listing

BHK_RE = re.compile(r"(\d(?:\.\d)?)\s*[- ]?\s*bhk", re.I)
STUDIO_RE = re.compile(r"\bstudio\b", re.I)

FURNISHING_PATTERNS = [
    (re.compile(r"\bsemi[\s-]?furnished\b", re.I), "semi"),
    (re.compile(r"\bfully[\s-]?furnished\b|\bfull(?:y)?\s*furnish", re.I), "full"),
    (re.compile(r"\bun[\s-]?furnished\b|\bbare\s?shell\b|\bno furnishing\b", re.I), "none"),
]

LIFT_YES_RE = re.compile(
    r"\blift\s*(available|present|:?\s*yes)\b|\bwith\s+lift\b|\blift\s*/?\s*elevator\b(?!\s*no)|\belevator\s*(available|present)\b",
    re.I,
)
LIFT_NO_RE = re.compile(
    r"\bno\s+lift\b|\blift\s*:?\s*no\b|\bwithout\s+lift\b|\bno\s+elevator\b",
    re.I,
)
# A bare "lift" mention with no explicit yes/no qualifier still counts as
# "the listing says this building has a lift" for most rental-post phrasing
# ("2nd floor, lift, semi-furnished") — but only when neither the explicit
# yes nor the explicit no pattern already matched, and only as a weaker signal.
LIFT_BARE_RE = re.compile(r"\blift\b|\belevator\b", re.I)

NO_BROKERAGE_RE = re.compile(
    r"\bno\s*[- ]?brokerage\b|\bzero\s*brokerage\b|\bbrokerage\s*free\b|\bno\s*broker\b|"
    r"\bwithout\s*brokerage\b|\bbrokerage\s*:?\s*(?:nil|0|zero|₹?\s*0)\b",
    re.I,
)
HAS_BROKERAGE_RE = re.compile(
    r"\bbrokerage\s*(applicable|involved|:?\s*yes)\b|\bbroker\s*contact\b|\b\d+\s*month'?s?\s*brokerage\b|"
    r"\bbrokerage\s*charges?\s*(applicable|apply)?\b(?!\s*(?:nil|0|zero))",
    re.I,
)

OWNER_RE = re.compile(
    r"\bowner\s*direct\b|\bdirect\s*from\s*owner\b|\bposted\s*by\s*owner\b|\bno\s*brokers?\s*please\b|"
    r"\bowner\s*:?\s*(?:yes)?\b(?=.{0,20}(?:contact|call|whatsapp))|\(owner\)",
    re.I,
)
BROKER_RE = re.compile(
    r"\bbroker\b(?!s?\s*please)|\bagent\b|\bproperty\s*consultant\b|\breal\s*estate\s*agent\b|\bposted\s*by\s*agent\b",
    re.I,
)

# Indian mobile numbers: optional +91/91 prefix, then a 10-digit number
# starting 6-9. Also catches wa.me/+91XXXXXXXXXX links.
PHONE_RE = re.compile(r"(?:\+?91[\s-]?)?([6-9]\d{9})\b")
WA_LINK_RE = re.compile(r"wa\.me/\+?(\d{10,12})", re.I)

RENT_RE = re.compile(r"(?:rent|monthly\s*rent|per\s*month|/\s*mo)[^\d₹]{0,15}(₹?\s?[\d,]+\s?k?)", re.I)
DEPOSIT_RE = re.compile(r"(?:deposit|advance|security\s*deposit)[^\d₹]{0,15}(₹?\s?[\d,]+\s?k?)", re.I)
BARE_MONEY_RE = re.compile(r"₹\s?([\d,]+\s?k?)")

AVAILABLE_FROM_RE = re.compile(
    r"available\s*(?:from)?\s*[:\-]?\s*([0-9]{1,2}(?:st|nd|rd|th)?\s*[A-Za-z]{3,9}|[A-Za-z]{3,9}\s*[0-9]{0,4}|immediately|immediate)",
    re.I,
)

# Common Bangalore area/locality names — used only to *find candidate location
# text* for geocoding, never to restrict which areas are searched (per spec,
# no predefined-neighbourhood restriction on matching).
LOCALITY_HINT_RE = re.compile(
    r"\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2}\s*(?:Nagar|Layout|Colony|Extension|Cross|Block|Road|Town|Halli|Palya))\b"
)


def _parse_money(raw: str) -> Optional[float]:
    raw = re.sub(r"\s+", "", raw).replace("₹", "")
    multiplier = 1
    if raw.lower().endswith("k"):
        multiplier = 1000
        raw = raw[:-1]
    raw = raw.replace(",", "")
    if not raw.isdigit():
        return None
    amount = int(raw) * multiplier
    # Real rent/deposit figures in Bangalore are never under four digits —
    # guards against matching a stray "Sector 7" or "2 months" as an amount.
    return float(amount) if amount >= 1000 else None


def _find_money(text: str, primary: "re.Pattern") -> Optional[float]:
    for m in primary.finditer(text):
        amount = _parse_money(m.group(1))
        if amount is not None:
            return amount
    return None


def extract_bhk(text: str) -> Optional[float]:
    m = BHK_RE.search(text)
    if m:
        return float(m.group(1))
    if STUDIO_RE.search(text):
        return 1.0
    return None


def extract_furnishing(text: str) -> Optional[str]:
    for pattern, value in FURNISHING_PATTERNS:
        if pattern.search(text):
            return value
    return None


def extract_lift(text: str) -> Optional[bool]:
    if LIFT_NO_RE.search(text):
        return False
    if LIFT_YES_RE.search(text):
        return True
    if LIFT_BARE_RE.search(text):
        return True
    return None  # not mentioned at all -> UNKNOWN, never assumed True


def extract_brokerage(text: str):
    """Returns (brokerage_status, brokerage_amount)."""
    if NO_BROKERAGE_RE.search(text):
        return "zero", 0.0
    if HAS_BROKERAGE_RE.search(text):
        return "broker", None
    return None, None


def extract_owner_status(text: str) -> Optional[str]:
    if OWNER_RE.search(text):
        return "owner"
    if BROKER_RE.search(text):
        return "broker"
    return None


def extract_contact(text: str) -> Optional[str]:
    wa = WA_LINK_RE.search(text)
    if wa:
        return f"WhatsApp: +{wa.group(1)}"
    phone = PHONE_RE.search(text)
    if phone:
        return phone.group(0).strip()
    return None


def extract_location(text: str) -> Optional[str]:
    m = LOCALITY_HINT_RE.search(text)
    return m.group(1).strip() if m else None


def extract_available_from(text: str) -> Optional[str]:
    m = AVAILABLE_FROM_RE.search(text)
    return m.group(1).strip() if m else None


def extract_title(text: str) -> Optional[str]:
    for line in text.splitlines():
        line = line.strip()
        if line:
            return line[:120]
    return None


def extract_fields(listing: Listing) -> Listing:
    """Fills a Listing's extracted fields from listing.raw_text in place,
    only overwriting fields that are still None (so a source connector that
    already knows something authoritatively, e.g. structured JSON from an
    Apify actor, isn't clobbered by a weaker regex guess)."""
    text = listing.raw_text or ""

    if listing.bhk is None:
        listing.bhk = extract_bhk(text)
    if listing.furnishing is None:
        listing.furnishing = extract_furnishing(text)
    if listing.lift is None:
        listing.lift = extract_lift(text)
    if listing.rent is None:
        listing.rent = _find_money(text, RENT_RE) or _find_money(text, BARE_MONEY_RE)
    if listing.deposit is None:
        listing.deposit = _find_money(text, DEPOSIT_RE)
    if listing.brokerage_status is None:
        status, amount = extract_brokerage(text)
        listing.brokerage_status = status
        if listing.brokerage_amount is None:
            listing.brokerage_amount = amount
    if listing.owner_status is None:
        listing.owner_status = extract_owner_status(text)
    if listing.location is None:
        listing.location = extract_location(text)
    if listing.available_from is None:
        listing.available_from = extract_available_from(text)
    if not listing.title:
        listing.title = extract_title(text)

    return listing
