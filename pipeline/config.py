"""
Fixed search criteria and pipeline configuration for this personal
FlatFinder instance. These are not user-adjustable filters in the UI —
they are the actual requirements the whole pipeline is built around.

Change these constants (not the UI) if the requirements ever change.
"""

import os

# ---- Hard requirements (see HARD FILTERING in the project spec) ----------
REQUIRED_BHK = 1
REQUIRED_FURNISHING = "semi"          # "semi" | "full" | "none"
MAX_RENT = 15000                      # INR / month
MAX_DEPOSIT = 50000                   # INR
REQUIRED_LIFT = True
REQUIRED_BROKERAGE_ZERO = True        # brokerage must be ₹0 / owner-direct
MAX_COMMUTE_MINUTES = 30

# ---- Fixed destination -----------------------------------------------------
OFFICE_NAME = "Bathla Aluminium Corporate Office"
OFFICE_ADDRESS = "Bathla Aluminium Corporate Office, Vasanth Nagar, Bangalore, Karnataka, India"

# ---- External services (all optional — the pipeline degrades honestly
# when a key isn't configured, it never fakes the result) ------------------
GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")
APIFY_TOKEN = os.environ.get("APIFY_TOKEN", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# Supabase — the pipeline writes with the service_role key, which bypasses
# row-level security entirely (see supabase/schema.sql). Never put this key
# anywhere client-side; only the public anon key belongs in config.js.
#
# Supabase's dashboard shows the "Project URL" right next to the REST API
# path (.../rest/v1/), which is an easy copy-paste mistake to make — strip
# it off here rather than 404ing, since store.py appends /rest/v1/... itself.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
if SUPABASE_URL.endswith("/rest/v1"):
    SUPABASE_URL = SUPABASE_URL[: -len("/rest/v1")]
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

NOMINATIM_USER_AGENT = "FlatFinder-Personal/1.0 (single-user rental search; contact via GitHub repo)"

# Local caches so repeated runs don't re-geocode/re-route the same strings
# (kind to Nominatim's/OSRM's free usage policies, and cheaper against
# Google's paid API).
CACHE_DIR = os.path.join(os.path.dirname(__file__), ".cache")
GEOCODE_CACHE_PATH = os.path.join(CACHE_DIR, "geocode_cache.json")
COMMUTE_CACHE_PATH = os.path.join(CACHE_DIR, "commute_cache.json")

# How long a listing can go unverified before the UI should stop calling it
# "Active" (see FRESHNESS in the project spec).
VERIFY_STALE_AFTER_HOURS = 48
POSSIBLY_UNAVAILABLE_AFTER_HOURS = 24 * 7
