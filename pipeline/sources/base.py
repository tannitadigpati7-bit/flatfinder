"""
The common interface every DISCOVERY source implements. A source's only
job is to produce raw Listing objects (source, source_listing_id, url,
title, raw_text set — everything else left None for later stages).

A source must NEVER:
  - fabricate a listing that doesn't correspond to a real post/page it
    actually fetched
  - fill in extracted fields itself unless it has them from structured,
    authoritative data (e.g. an API's own JSON fields) — plain text should
    be left for extraction.py
  - bypass authentication, CAPTCHAs, or anti-bot protections to reach data

Add a new source by subclassing Source and implementing discover().
"""

from abc import ABC, abstractmethod
from typing import List

from listing_schema import Listing


class Source(ABC):
    name: str = "unnamed-source"

    @abstractmethod
    def discover(self) -> List[Listing]:
        """Returns freshly discovered raw listings. Must not raise on a
        single bad item — skip it and keep going; the whole source failing
        (network down, page structure changed) should raise so the runner
        can log it, but one source failing must never take down the others."""
        raise NotImplementedError
