"""
DISCOVERY source: public Telegram channel previews.

Reads t.me/s/<channel> — Telegram's own public, unauthenticated HTML
preview of a channel's recent messages. Same page any browser gets with no
account, no Bot API token, no MTProto client. Only *channels* expose this
(t.me/s/<group> redirects instead of showing content, since reading a
group requires actually joining it — this deliberately does not do that).

This source no longer filters by locality (the old version required a
match against a fixed North-Bangalore/Indiranagar/HSR list) — every
message that looks like a rental post is emitted as a raw listing and the
pipeline's own geocoding + commute stages decide whether it's within 30
minutes of the office, wherever in Bangalore it is.
"""

import os
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import List

from listing_schema import Listing
from sources.base import Source

DEFAULT_CHANNELS = "HousingBangalore,housingourbengaluru"

MSG_WRAPPER_RE = re.compile(r'<div class="tgme_widget_message[^"]*"\s+data-post="([^"]+)"[^>]*>')
MSG_TEXT_RE = re.compile(r'<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)</div>')

# A message is worth extracting only if it plausibly describes a rental at
# all — otherwise a channel's off-topic chatter would flood the pipeline
# with garbage "listings". This is a cheap pre-filter, not the hard filter.
RENTAL_HINT_RE = re.compile(r"\bbhk\b|\brent\b|\bfor rent\b|\bavailable\b.{0,20}\brent", re.I)


def _strip_html(fragment: str) -> str:
    import html as html_module
    text = re.sub(r"<br\s*/?>", "\n", fragment)
    text = re.sub(r"<[^>]+>", "", text)
    text = html_module.unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


class TelegramPublicSource(Source):
    name = "telegram_public"

    def __init__(self, channels=None):
        self.channels = channels or [
            c.strip() for c in os.environ.get("TG_CHANNELS", DEFAULT_CHANNELS).split(",") if c.strip()
        ]

    def _fetch_channel_html(self, channel: str) -> str:
        url = f"https://t.me/s/{urllib.parse.quote(channel)}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; FlatFinderBot/1.0)"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8", errors="replace")

    def _listings_from_channel(self, channel: str) -> List[Listing]:
        html_doc = self._fetch_channel_html(channel)
        wrappers = list(MSG_WRAPPER_RE.finditer(html_doc))
        texts = list(MSG_TEXT_RE.finditer(html_doc))

        listings = []
        for wrapper_match, text_match in zip(wrappers, texts):
            data_post = wrapper_match.group(1)  # "channel/12345"
            post_id = data_post.split("/")[-1]
            text = _strip_html(text_match.group(1))
            if not text or not RENTAL_HINT_RE.search(text):
                continue
            listings.append(Listing(
                source=f"Telegram @{channel}",
                source_listing_id=post_id,
                url=f"https://t.me/{channel}/{post_id}",
                raw_text=text,
            ))
        return listings

    def discover(self) -> List[Listing]:
        all_listings: List[Listing] = []
        for channel in self.channels:
            try:
                all_listings.extend(self._listings_from_channel(channel))
            except (urllib.error.URLError, TimeoutError) as err:
                print(f"[telegram_public] failed to fetch @{channel}: {err}")
                continue
        return all_listings
