"""
Offline sanity tests — no network. Exercises extraction -> validation ->
filtering -> dedup -> scoring against synthetic raw text, with geocoding/
commute stubbed in directly (as if GEOCODING/COMMUTE already ran), so this
can run in any sandboxed environment without hitting Nominatim/OSRM/Google.

Not a replacement for testing the real sources against live data — just
proof the deterministic stages behave as specified.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import extraction
import validation
import filtering
import dedup
import scoring
from listing_schema import Listing

PASS_TEXT = (
    "1 BHK Semi furnished flat for rent near Vasanth Nagar\n"
    "Rent: 14000 Deposit: 40000\n"
    "Lift available. Owner direct, no brokerage.\n"
    "Contact: 9845012345"
)

FAIL_RENT_TEXT = (
    "1BHK semi furnished, Rent: 22000, Deposit 40000, lift available, "
    "no brokerage, owner direct. Call 9845012346"
)

UNKNOWN_LIFT_TEXT = (
    "1BHK semi furnished flat, Rent 13500, Deposit 35000, no brokerage, "
    "owner direct. Call 9845012347"
)

BROKER_TEXT = (
    "1BHK semi furnished, Rent 12000, Deposit 30000, lift available, "
    "brokerage applicable, broker contact 9845012348"
)


def make_listing(source, sid, text, url):
    l = Listing(source=source, source_listing_id=sid, url=url, raw_text=text)
    extraction.extract_fields(l)
    validation.validate_fields(l)
    return l


def test_confirmed_pass():
    l = make_listing("test", "1", PASS_TEXT, "https://example.com/1")
    l.lat, l.lng = 12.9915, 77.5928  # stand-in coords near Vasanth Nagar
    l.commute_minutes, l.commute_source = 18.0, "osrm_driving"
    filtering.apply_hard_filter(l)
    assert l.match_status == "confirmed", (l.match_status, l.fail_reasons, l.unknown_fields)
    assert l.rent == 14000
    assert l.deposit == 40000
    assert l.lift is True
    assert l.brokerage_status == "zero"
    assert l.owner_status == "owner"
    print("test_confirmed_pass OK")


def test_rejected_over_rent():
    l = make_listing("test", "2", FAIL_RENT_TEXT, "https://example.com/2")
    l.lat, l.lng = 12.99, 77.59
    l.commute_minutes, l.commute_source = 15.0, "osrm_driving"
    filtering.apply_hard_filter(l)
    assert l.match_status == "rejected", l.match_status
    assert any("rent" in r for r in l.fail_reasons)
    print("test_rejected_over_rent OK")


def test_needs_verification_unknown_lift():
    l = make_listing("test", "3", UNKNOWN_LIFT_TEXT, "https://example.com/3")
    l.lat, l.lng = 12.99, 77.59
    l.commute_minutes, l.commute_source = 12.0, "osrm_driving"
    filtering.apply_hard_filter(l)
    assert l.lift is None
    assert l.match_status == "needs_verification", l.match_status
    assert "lift" in l.unknown_fields
    print("test_needs_verification_unknown_lift OK")


def test_rejected_brokerage():
    l = make_listing("test", "4", BROKER_TEXT, "https://example.com/4")
    l.lat, l.lng = 12.99, 77.59
    l.commute_minutes, l.commute_source = 10.0, "osrm_driving"
    filtering.apply_hard_filter(l)
    assert l.brokerage_status == "broker"
    assert l.match_status == "rejected"
    print("test_rejected_brokerage OK")


def test_missing_commute_never_passes():
    l = make_listing("test", "5", PASS_TEXT, "https://example.com/5")
    # No geocode/commute computed at all.
    filtering.apply_hard_filter(l)
    assert l.match_status == "needs_verification"
    assert "commute" in l.unknown_fields
    print("test_missing_commute_never_passes OK")


def test_dedup_merges_same_phone_different_sources():
    a = make_listing("NoBroker", "a1", PASS_TEXT, "https://nobroker.in/a1")
    b_text = PASS_TEXT.replace("Vasanth Nagar", "Vasanth Nagar area")
    b = make_listing("Telegram @x", "b1", b_text, "https://t.me/x/1")
    for l in (a, b):
        l.lat, l.lng = 12.99, 77.59
        l.commute_minutes, l.commute_source = 15.0, "osrm_driving"
        filtering.apply_hard_filter(l)
    merged = dedup.deduplicate([a, b])
    assert len(merged) == 1, len(merged)
    assert len(merged[0].merged_sources) == 2
    print("test_dedup_merges_same_phone_different_sources OK")


def test_scoring_orders_by_commute_then_rent():
    near_expensive = make_listing("test", "6", PASS_TEXT.replace("14000", "14500"), "https://example.com/6")
    far_cheap = make_listing("test", "7", PASS_TEXT.replace("14000", "13000"), "https://example.com/7")
    for l, commute in ((near_expensive, 10.0), (far_cheap, 25.0)):
        l.lat, l.lng = 12.99, 77.59
        l.commute_minutes, l.commute_source = commute, "osrm_driving"
        filtering.apply_hard_filter(l)
        assert l.match_status == "confirmed"
    ranked = scoring.rank_confirmed([far_cheap, near_expensive])
    assert ranked[0] is near_expensive, "shortest commute should rank first even though rent is higher"
    print("test_scoring_orders_by_commute_then_rent OK")


if __name__ == "__main__":
    test_confirmed_pass()
    test_rejected_over_rent()
    test_needs_verification_unknown_lift()
    test_rejected_brokerage()
    test_missing_commute_never_passes()
    test_dedup_merges_same_phone_different_sources()
    test_scoring_orders_by_commute_then_rent()
    print("\nAll offline pipeline tests passed.")
