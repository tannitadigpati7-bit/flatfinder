#!/usr/bin/env python3
"""
Pulls new flat-rental posts from public Telegram channels' web previews
(https://t.me/s/<channel>) and pushes matching ones into the shared Firebase
Realtime Database, the same way scrape_nobroker.py does for NoBroker.

Why this is fine to fetch: t.me/s/<channel> is Telegram's own public,
unauthenticated HTML preview of a channel — the same page anyone gets by
visiting the link in a browser with no account, no login, no API key. It's
not the Bot API, not MTProto, not a private/authenticated surface — this
script is reading a public webpage, same as any browser would.

The markup below (data-post="channel/id" on each message wrapper,
tgme_widget_message_text for the body) was verified directly against a live
fetch of t.me/s/HousingBangalore before writing this, not guessed at.

Required environment variables:
  FIREBASE_DB_URL - your Firebase Realtime Database URL, e.g.
                    https://your-project-default-rtdb.firebaseio.com
                    (see README.md > "Setting up the shared backend")
Optional:
  TG_CHANNELS     - comma-separated public CHANNEL usernames to check
                    (default: verified-working Bangalore flat-hunting channels)
  DRY_RUN         - if "1", fetch and print results but don't post/notify

Note on channels vs. groups: only Telegram *channels* expose the public
t.me/s/<name> preview used here. Telegram *groups* (including some
flat-hunting ones) don't — visiting t.me/s/<group> redirects instead of
showing content, and this script will just find 0 messages for it. Before
adding a name to TG_CHANNELS, confirm it's a channel: run
`curl -sI https://t.me/s/<name> | head -1` — a 200 means it works, a 302
means it's a group (or private) and reading it would require actually
joining, which this script deliberately does not do.
"""

import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FIREBASE_DB_URL = os.environ.get("FIREBASE_DB_URL", "").rstrip("/")
DRY_RUN = os.environ.get("DRY_RUN") == "1"

DEFAULT_CHANNELS = "HousingBangalore,housingourbengaluru"
CHANNELS = [c.strip() for c in os.environ.get("TG_CHANNELS", DEFAULT_CHANNELS).split(",") if c.strip()]

# Keep this in sync with the TARGET_LOCALITIES list in parser.js.
TARGET_LOCALITIES = [
    "manyata", "hebbal", "nagawara", "thanisandra", "hbr layout", "hrbr",
    "jakkur", "yelahanka", "rt nagar", "hennur", "kalyan nagar",
    "banaswadi", "kammanahalli", "horamavu",
    "indiranagar", "indira nagar", "indranagar", "domlur",
    "hsr layout", "hsr", "agara",
]

NO_BROKERAGE_RE = re.compile(
    r"\bno\s*[- ]?brokerage\b|\bzero\s*brokerage\b|\bbrokerage\s*free\b|\bno\s*broker\b|\bwithout\s*brokerage\b",
    re.I,
)
BHK_RE = re.compile(r"(\d(?:\.\d)?)\s*[- ]?\s*bhk", re.I)
STUDIO_RE = re.compile(r"\bstudio\b", re.I)
FURNISHING_PATTERNS = [
    (re.compile(r"\bfully[\s-]?furnished\b|\bfull furnish", re.I), "full"),
    (re.compile(r"\bsemi[\s-]?furnished\b", re.I), "semi"),
    (re.compile(r"\bun[\s-]?furnished\b|\bbare\s?shell\b", re.I), "none"),
]
RENT_RE = re.compile(r"rent[^\d₹]{0,15}(₹?\s?[\d,]+\s?k?)", re.I)
BARE_MONEY_RE = re.compile(r"₹\s?([\d,]+\s?k?)")
DEPOSIT_RE = re.compile(r"deposit[^\d₹]{0,15}(₹?\s?[\d,]+\s?k?)", re.I)
WA_LINK_RE = re.compile(r"wa\.me/\+?(\d{10,12})", re.I)
PHONE_RE = re.compile(r"(?:\+?91[\s-]?)?([6-9]\d{9})\b")

MSG_WRAPPER_RE = re.compile(r'<div class="tgme_widget_message[^"]*"\s+data-post="([^"]+)"[^>]*>')
MSG_TEXT_RE = re.compile(r'<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)</div>')


def strip_html(fragment):
    text = re.sub(r"<br\s*/?>", "\n", fragment)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def parse_money_value(raw):
    # \s? in the surrounding regexes can capture a trailing newline (Telegram
    # messages are full of them), so strip ALL whitespace, not just spaces,
    # before validating — otherwise "12,700\n" fails isdigit() and silently
    # falls through to a smaller, wrong number further down the message.
    raw = re.sub(r"\s+", "", raw).replace("₹", "")
    multiplier = 1
    if raw.lower().endswith("k"):
        multiplier = 1000
        raw = raw[:-1]
    raw = raw.replace(",", "")
    if not raw.isdigit():
        return None
    amount = int(raw) * multiplier
    # Guards against false positives like "for Rent in ... Sector 7" (bare
    # "7") or "Deposit: 4 months" (bare "4") — real rent/deposit figures in
    # Bangalore are never under four digits.
    return amount if amount >= 1000 else None


def find_money(pattern, text, fallback_pattern=None):
    # A keyword like "rent" can appear more than once (e.g. "Apartment for
    # Rent in HSR, Sector 7" before the real "Rent: 33k") — try every match
    # in order and keep the first one that parses to a plausible amount,
    # instead of only ever looking at the first regex hit.
    for regex in filter(None, [pattern, fallback_pattern]):
        for match in regex.finditer(text):
            amount = parse_money_value(match.group(1))
            if amount is not None:
                return amount
    return ""


def extract_listing(channel, post_id, text):
    lower = text.lower()

    locality = next((loc for loc in TARGET_LOCALITIES if loc in lower), None)
    if not locality:
        return None

    if not NO_BROKERAGE_RE.search(text):
        # Require an explicit no-brokerage statement rather than assuming —
        # these channels aren't exclusively owner posts.
        return None

    bhk_match = BHK_RE.search(text)
    if bhk_match:
        bhk = float(bhk_match.group(1))
    elif STUDIO_RE.search(text):
        bhk = 1
    else:
        bhk = 1

    furnishing = ""
    for pattern, value in FURNISHING_PATTERNS:
        if pattern.search(text):
            furnishing = value
            break

    rent = find_money(RENT_RE, text, BARE_MONEY_RE)
    deposit = find_money(DEPOSIT_RE, text)

    wa_match = WA_LINK_RE.search(text)
    if wa_match:
        contact = f"WhatsApp: +{wa_match.group(1)}"
    else:
        phone_match = PHONE_RE.search(text)
        contact = phone_match.group(0).strip() if phone_match else ""

    title = next((line.strip() for line in text.splitlines() if line.strip()), "")[:120]

    return {
        "title": title or f"Listing from Telegram @{channel}",
        "locality": locality.title(),
        "distanceKm": "",
        "bhk": bhk,
        "furnishing": furnishing,
        "rent": rent if rent != "" else "",
        "deposit": deposit if deposit != "" else "",
        "brokerage": False,
        "contact": contact,
        "source": f"Telegram @{channel}",
        "link": f"https://t.me/{channel}/{post_id}",
        "notes": text[:500],
    }


def fetch_channel_html(channel):
    url = f"https://t.me/s/{urllib.parse.quote(channel)}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; FlatFinderBot/1.0)"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def fetch_channel_listings(channel):
    html_doc = fetch_channel_html(channel)
    wrappers = list(MSG_WRAPPER_RE.finditer(html_doc))
    texts = list(MSG_TEXT_RE.finditer(html_doc))
    # Both regexes match message-level divs in document order and Telegram's
    # preview emits exactly one message_text block per message wrapper.
    pairs = zip(wrappers, texts)

    listings = []
    for wrapper_match, text_match in pairs:
        data_post = wrapper_match.group(1)  # "channel/12345"
        post_id = data_post.split("/")[-1]
        text = strip_html(text_match.group(1))
        listing = extract_listing(channel, post_id, text)
        if listing:
            listings.append(listing)
    return listings


def http_json(url, data=None, method="GET"):
    if data is not None:
        body = json.dumps(data).encode()
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("Content-Type", "application/json")
    else:
        req = urllib.request.Request(url, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def fetch_existing_links():
    if not FIREBASE_DB_URL:
        return set()
    # Firebase returns {pushId: {...listing}, ...} — or null if the node is empty.
    existing = http_json(f"{FIREBASE_DB_URL}/listings.json") or {}
    return {listing.get("link") for listing in existing.values() if listing.get("link")}


def main():
    all_listings = []
    for channel in CHANNELS:
        try:
            found = fetch_channel_listings(channel)
        except Exception as err:  # noqa: BLE001 - one channel failing shouldn't kill the run
            print(f"Failed to fetch @{channel}: {err}", file=sys.stderr)
            continue
        print(f"@{channel}: {len(found)} matching post(s) in the latest page.")
        all_listings.extend(found)

    if DRY_RUN:
        print(f"DRY_RUN=1 — {len(all_listings)} total matches, not posting. Sample:")
        for listing in all_listings[:5]:
            print(json.dumps(listing, indent=2, ensure_ascii=False))
        return

    if not FIREBASE_DB_URL:
        print("FIREBASE_DB_URL not set, aborting.", file=sys.stderr)
        sys.exit(1)

    existing_links = fetch_existing_links()
    new_listings = [l for l in all_listings if l["link"] not in existing_links]
    print(f"{len(new_listings)} new listing(s) not already in the database.")

    for listing in new_listings:
        http_json(f"{FIREBASE_DB_URL}/listings.json", data=listing, method="POST")
        print(f"Added: {listing['title']} ({listing['locality']}) — {listing['link']}")


if __name__ == "__main__":
    main()
