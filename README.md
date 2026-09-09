# FlatFinder

A personal rental search engine, not a listing site. It exists to answer one
question: **find a real 1BHK I can actually rent, within 30 minutes of
Bathla Aluminium Corporate Office, Vasanth Nagar, Bangalore.**

Fixed requirements (not adjustable filters — the whole pipeline is built
around these; see [`pipeline/config.py`](pipeline/config.py) and
[`config.js`](config.js)):

- 1 BHK, semi-furnished
- Rent ≤ ₹15,000/month, deposit ≤ ₹50,000
- Lift mandatory
- Brokerage ₹0 / owner-direct preferred
- ≤ 30 minutes' commute to Bathla Aluminium Corporate Office, Vasanth Nagar
  — computed as actual driving time, not straight-line distance
- Anywhere in Bangalore — there is no predefined neighbourhood allowlist;
  commute time is the only geographic filter

**Data discipline:** nothing here is fabricated. Every field a listing
doesn't clearly support stays `null` ("UNKNOWN" in the UI) — it is never
assumed to satisfy a hard requirement. A listing only appears under
**Confirmed Matches** when every hard requirement is both known and met.
Zero confirmed matches is a valid, expected result, and the UI says exactly
that rather than padding the page with near-misses.

Contact details (phone numbers, WhatsApp links) are deliberately **never
stored or shown** for scraped listings — `pipeline/listing_schema.py`'s
`Listing` has no contact field at all, and nothing in the pipeline writes
one. What every card shows instead is the original source `url` — a "View
Original Listing" link, or, if a listing genuinely has none (rare — every
Telegram/Apify-sourced listing carries one; only a hand-typed manual
capture without a link can lack it), an explicit "No source link
available" notice. Never silently omitted.

Each card also shows a thumbnail when `image_url` is set — a real photo URL
lifted straight from the source (Telegram's own post image via
`tgme_widget_message_photo_wrap`, or an Apify actor's own image field, both
best-effort per-source extraction, never generated or stock). No image_url
means no thumbnail slot, not a placeholder. Tapping a listing expands it
in place; tapping the expanded row again (or the "View Original Listing"
link inside it) opens the source `url`.

## Personalizing for your own search (profile.js)

`config.js`'s `OFFICE_ADDRESS`/`REQUIREMENTS` are this deployment's
*defaults*, not a hard requirement to edit code — the site now asks each
visitor to confirm or replace them in a one-time sign-up form (skippable
only by already having a saved profile), stored in that browser's
`localStorage` via `profile.js`. No accounts, no password, nothing sent
anywhere — it's per-device, and re-editable anytime via the ⚙︎ button in
the header or the "Edit" link next to "Configured requirements".

Since the shared pipeline (`pipeline/run.py`) only ever computes
`match_status`/`commute_minutes` once, against *this deployment's own*
default office/requirements, a visitor whose saved profile actually
differs from those defaults gets those decisions **recomputed
client-side** (`recomputeForProfile` in `app.js`) using each listing's
already-extracted raw fields (rent, bhk, lat/lng, etc.) — never a guess,
just the same `filter-client.js` logic the pipeline itself runs, evaluated
against different inputs. Nothing is written back to the shared database;
this only changes what that one browser displays. A profile identical to
the deployment's defaults skips this entirely and trusts the pipeline's
own (more accurate, traffic-aware-if-configured) stored values as-is.

**Known limitation:** this personalization only applies to the main site
(`index.html`). The Chrome extension and the mobile share-target
(`share.html`) still hard-filter a manually captured listing against
`config.js`'s fixed defaults, not a saved profile — they don't load
`profile.js`. If this matters to you, it's a reasonable follow-up: wire
those two capture surfaces to read the same saved profile before calling
`applyHardFilter`.

## Architecture

```
DISCOVERY → RAW STORAGE → EXTRACTION → VALIDATION → GEOCODING
→ COMMUTE CALCULATION → HARD FILTERING → DEDUPLICATION → SCORING
→ SEARCH UI / ALERTS
```

Implemented in [`pipeline/`](pipeline/), run on a schedule by
[`.github/workflows/run-pipeline.yml`](.github/workflows/run-pipeline.yml):

| Stage | Module | What it does |
|---|---|---|
| Discovery | `pipeline/sources/*.py` | Each source implements one `discover()` method returning raw listings (original text + URL, nothing else guessed). Add a source by subclassing `sources.base.Source`. |
| Raw storage / freshness | `pipeline/store.py` | Upserts to Supabase per listing (never a destructive full-table overwrite), tracking `first_seen`/`last_seen`/`last_verified`/`source_status`. |
| Extraction | `pipeline/extraction.py` | Deterministic regex parsing into BHK, rent, deposit, furnishing, lift, brokerage, owner status, location, available-from. Leaves a field `None` rather than guessing. |
| Validation | `pipeline/validation.py` | Sanity-bounds values (e.g. a "rent" of ₹7 is a mis-parse, not a real rent) — out-of-range becomes UNKNOWN, not clamped-and-kept. |
| Geocoding | `pipeline/geocode.py` | Nominatim (OpenStreetMap), cached, rate-limited to its usage policy. |
| Commute | `pipeline/commute.py` | Google Distance Matrix with live traffic when `GOOGLE_MAPS_API_KEY` is set; OSRM real road-network driving time (no live traffic) otherwise. Every listing records which one computed it. |
| Hard filtering | `pipeline/filtering.py` | The only stage allowed to set `match_status` — `confirmed` / `needs_verification` / `rejected`, with `fail_reasons` for rejects and `unknown_fields` for unverifiable ones. |
| Deduplication | `pipeline/dedup.py` | Merges the same property posted on multiple sites (phone number match, or coordinates+rent+BHK match, or fuzzy address+rent+deposit+BHK match), keeping every source URL. |
| Scoring | `pipeline/scoring.py` | Ranks confirmed matches: commute, then rent, then deposit, then owner-direct confidence, then amenities, then freshness. |

The static site ([`index.html`](index.html) / [`app.js`](app.js)) reads the
pipeline's output and renders **Confirmed Matches**, a collapsible **Needs
Verification** section, and **Near Matches** (real listings that fail one
or more hard requirements, each labelled with exactly which one).

A listing you spot yourself — Facebook group, WhatsApp, anywhere the
pipeline can't reach — goes through the identical extraction → geocode →
commute → hard-filter pipeline client-side
([`filter-client.js`](filter-client.js), [`geo-client.js`](geo-client.js))
before it's saved, via the **+ Add a listing** form, the
[Chrome extension](#chrome-extension-facebook-whatsapp-web-anywhere), or the
[mobile share target](#mobile-android-share-sheet). It is never
pre-approved just because a human typed it in.

## Sources — what's actually automatable, honestly

| Source | Status | Why |
|---|---|---|
| Telegram public channels | **Automated**, free | `t.me/s/<channel>` is Telegram's own public, unauthenticated preview — same as any browser gets with no account. Only works for *channels*, not *groups* (groups require joining, which this deliberately doesn't do). |
| NoBroker / Housing / 99acres / MagicBricks | **Automated via Apify, needs your own verification** | None publish a public API; all are JS-heavy with anti-bot protection that this project will not attempt to defeat. `pipeline/sources/apify_generic.py` calls a maintained third-party Apify actor per site instead — see [setup below](#apify-setup-nobroker-housing-99acres-magicbricks). |
| Facebook Marketplace / rental groups | **Not automatable, manual capture only** | Facebook's Graph API doesn't expose Marketplace or group post search, and scraping either violates Facebook's Terms of Service with real ban risk to your account. This project will not bypass that. The [extension](#chrome-extension-facebook-whatsapp-web-anywhere) and [mobile share target](#mobile-android-share-sheet) turn "I saw a post" into a filtered, hard-checked listing in one action — you're still the one reading the group. |
| Other public owner listings | **Manual capture**, same path as Facebook | Add a source connector (`pipeline/sources/base.Source`) if you find one with a legitimate public API/preview, same pattern as Telegram. |

## Running the pipeline

```bash
cd pipeline
python3 run.py --dry-run     # discover + process, print a sample, write nothing
python3 run.py                # writes confirmed/needs_verification/rejected listings to Supabase
```

No third-party Python packages required — stdlib only.

Offline unit tests (no network — exercises extraction/filtering/dedup/scoring
against synthetic text, safe to run anywhere):

```bash
cd pipeline
python3 tests/test_pipeline_offline.py
```

## Setting up the shared backend (Supabase)

Same backend the site, extension, share target, and pipeline all read/write
to — genuinely free at this scale. Postgres under the hood via
[`supabase/schema.sql`](supabase/schema.sql), instead of the schemaless
Firebase Realtime Database this used to run on (migrated because the
listing data is fully structured — typed rent/deposit/commute fields,
`match_status` — which Postgres + row-level security fits better than a
JSON blob with open read/write rules).

1. Go to [supabase.com](https://supabase.com), sign in, **New project**
   (any name/region; note the database password it generates, though this
   setup doesn't need it directly).
2. **SQL Editor → New query** → paste the entire contents of
   [`supabase/schema.sql`](supabase/schema.sql) → **Run**. This creates the
   `listings` table with row-level security already configured:
   - **Public read** — the site/extension/share target need this to show
     listings.
   - **Public insert** — lets manually captured listings (paste box,
     extension, mobile share) save without exposing a privileged key in the
     browser.
   - **No public update/delete of pipeline fields** — once a row exists,
     rent/deposit/match_status/score/etc. can only be changed by the
     pipeline itself (via its service-role key, which bypasses RLS). This is
     tighter than the old Firebase rules, which allowed anyone with the URL
     to edit or delete any row.
   - **Public update of exactly two columns** (`notes`, `personal_status`)
     — powers the "All Listings" table's inline notes/status editing (see
     below). Column-level grants mean the anon key can only ever touch
     these two fields, never `match_status` or anything else.
3. **Project Settings → API** → copy the **Project URL** and the **anon
   public** key.
4. Paste both into `config.js` (and `extension/config.js` — keep them in
   sync, same as `parser.js`):
   ```js
   const CONFIG = { SUPABASE_URL: "https://your-project.supabase.co", SUPABASE_ANON_KEY: "eyJ...", ... };
   ```
   The anon key is safe to ship in client-side code — RLS is what actually
   enforces what it can do (read everything, insert new rows, and edit the
   `notes`/`personal_status` columns — nothing else).
5. Same **Project Settings → API** page → copy the **service_role** key.
   **Never** put this in `config.js` or anywhere the browser loads — it
   bypasses RLS entirely. In this repo's **Settings → Secrets and variables
   → Actions**, add two secrets: `SUPABASE_URL` (same value as above) and
   `SUPABASE_SERVICE_ROLE_KEY` (the service_role key). Only the scheduled
   pipeline workflow uses this.
6. Commit and push.

If you already ran an earlier version of `schema.sql` and are updating an
existing project (e.g. to pick up the `notes`/`personal_status` columns
below), just re-run the whole file again — every statement in it is
idempotent (`create table if not exists`, `alter table ... add column if
not exists`, `drop policy if exists` before each `create policy`), so
re-running is always safe and only adds what's missing.

Listings live in the `listings` table, shaped like
[`pipeline/listing_schema.py`](pipeline/listing_schema.py)'s `Listing`
dataclass (source, url, raw_text, every extracted/geocoded/scored field,
`match_status`, `fail_reasons`, `unknown_fields`), plus two columns the
pipeline never touches: `notes` and `personal_status` — see "All Listings
table" below.

### All Listings table

The frontend's card view only ever shows Confirmed/Needs
Verification/Near Matches — deliberately never a raw dump, per the
project's own filtering rules. For seeing genuinely everything (including
`rejected`), sorting by any column, and tracking your own progress, switch
to **"All Listings (table)"** at the top of the page:

- Every listing, any status, sortable by clicking a column header.
- **Notes** and **My status** (Not contacted / Contacted / Visited / Not
  interested) are yours to edit inline — saved automatically a moment
  after you stop typing/change the dropdown. These two columns are the
  only thing the browser is allowed to write back to an existing row (see
  RLS setup above) — editing them can never change a listing's actual
  `match_status` or any other pipeline-computed field.

## Commute calculation setup (Google Maps, optional but recommended)

Without a key, commute times come from OSRM — real road-network driving
time, but **no live traffic**, which matters a lot in Bangalore. With a key,
commute times use Google's Distance Matrix API with `departure_time=now`
and `traffic_model=best_guess` — genuinely traffic-aware, and every listing
records which provider computed its number (`commute_source`).

1. [console.cloud.google.com](https://console.cloud.google.com) → create a
   project → enable **Distance Matrix API** and **Geocoding API** → enable
   billing (Google's free monthly credit typically covers personal-scale
   usage, but billing must be turned on to get a working key).
2. **APIs & Services → Credentials** → create an API key. Restrict it to
   the Distance Matrix API.
3. Add repo secret `GOOGLE_MAPS_API_KEY`. Never put this key in `config.js`
   or any file the browser loads — it's used only server-side, in the
   scheduled pipeline. Manually captured listings (extension/share target)
   always use the free OSRM path, by design, so a paid key never ships to
   a browser where anyone could read it from page source.

## Apify setup (NoBroker, Housing, 99acres, MagicBricks)

1. Sign up at [apify.com](https://apify.com) (free tier available).
2. For each site you want, find (or build) an Apify actor that scrapes it,
   and note its actor id and real input/output schema from its **Input**
   and **Runs → Dataset** tabs — `pipeline/sources/apify_generic.py`'s
   `FIELD_CANDIDATES` is a best-effort guess at common field names and may
   not match; adjust it once you've inspected a real run's output.
3. Add repo secret `APIFY_TOKEN`.
4. Add repo variable `APIFY_SITES` (e.g. `nobroker,housing`).
5. For each site in that list, add repo variables
   `APIFY_SITE_<NAME>_ACTOR_ID` and, if the actor needs specific input,
   `APIFY_SITE_<NAME>_INPUT` (a JSON string) — e.g.
   `APIFY_SITE_NOBROKER_ACTOR_ID`, `APIFY_SITE_NOBROKER_INPUT`.
6. Test with **Actions → Run FlatFinder discovery pipeline → Run workflow**,
   dry run checked, and check the logs.

A site with no actor id configured is silently skipped, not guessed at.

## Chrome extension (Facebook, WhatsApp Web, anywhere)

Lives in [`extension/`](extension/). It never scrapes in the background —
only acts on text you've already selected on a page you're already looking
at, which is why it's fine for Facebook and WhatsApp Web even though an
automated background scraper against either would not be.

**Install (unpacked):**
1. Edit `extension/config.js` with your `SUPABASE_URL`/`SUPABASE_ANON_KEY`
   (same values as the main site's `config.js`).
2. `chrome://extensions` → **Developer mode** → **Load unpacked** → select
   `extension/`.

**Use:** select a post's text on any page → right-click → **Save selection
to FlatFinder**, or click the toolbar icon and paste → review the
auto-filled fields (BHK, lift, brokerage, owner status all extracted the
same way the pipeline does it) → **Save**. The popup computes geocode +
commute + the hard filter before saving and shows you the resulting match
status.

**On Facebook specifically** (`facebook.com`/`m.facebook.com`), a "Save to
FlatFinder" button is injected directly onto each post/listing on screen
(`content-facebook.js`) — click it instead of manually selecting text; it
grabs that one post's visible text and opens the same review popup. Nothing
is read or sent unless you click that button on that specific post — there
is no background scanning. This is anchored to Facebook's `role="article"`
markup, the most stable hook available on a page whose class names change
often by design; if Facebook changes this and the button stops appearing,
the manual select+right-click flow above still works unaffected.

## Mobile (Android)

Two options, both driven by the same `extension/` code — nothing mobile-specific to build separately.

**Kiwi Browser (recommended for the Facebook capture button):** Kiwi is a
free, Chromium-based Android browser that loads unpacked Chrome extensions
exactly like desktop Chrome does. Install Kiwi from the Play Store, go to
its `chrome://extensions` page, enable Developer mode, **Load unpacked**,
and select the same `extension/` folder — the injected Facebook button and
right-click capture both work identically to desktop. Stock Android Chrome
does not support extensions at all, so this only works in Kiwi (or another
Chromium browser with extension support).

**Share sheet (works in any Android browser/app, no extension needed):**
installable as a PWA, which adds it to Android's **Share** menu.

1. Open the site on your phone in Chrome → **Add to Home screen**.
2. In WhatsApp/Facebook/Telegram, **Share** a post → **FlatFinder**.
3. Review the auto-filled, hard-filtered fields → **Save listing**.

Needs the shared Supabase backend configured. iOS Safari doesn't support
share targets for installed web apps, and Safari extensions require Xcode +
a paid Apple Developer account to package — copy the post text into the
**+ Add a listing** paste box on the main site instead.

## Freshness

Every listing tracks `first_seen`, `last_seen`, `last_verified`, and a
derived `source_status`:

- **Active** — seen or verified recently.
- **Not recently verified** — still showing up in discovery, but nothing
  has re-confirmed it exists recently.
- **Possibly unavailable** — hasn't been re-discovered in a while.
- **Unavailable** — hasn't been re-discovered in a long while.

Thresholds live in `pipeline/config.py` (`VERIFY_STALE_AFTER_HOURS`,
`POSSIBLY_UNAVAILABLE_AFTER_HOURS`).

## Alerts (not yet wired up)

The pipeline already knows which listings are newly `confirmed` each run
(`first_seen == last_seen` on a `confirmed` listing) — a Telegram/WhatsApp
notification step can hook into `pipeline/run.py` after the SCORING stage
to push those out. Not built yet because it needs your own notification
channel (a Telegram bot token, or similar) — happy to wire it in once you
pick one; it will only ever fire for genuinely confirmed matches, never for
needs-verification or rejected listings.

## Ideas for later

- LLM-assisted extraction pass for listings the regex pass leaves partially
  UNKNOWN (a `pipeline/llm_extract.py` layered on top of `extraction.py`,
  using `ANTHROPIC_API_KEY` — never allowed to turn UNKNOWN into a
  hard-filter pass on its own, only to suggest a value for human review).
- Publish the extension to the Chrome Web Store instead of load-unpacked.
- Add more public (channel, not group) Telegram sources.
