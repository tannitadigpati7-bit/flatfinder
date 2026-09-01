# FlatFinder

A search tool + capture toolkit for finding 1BHK fully-furnished,
no-brokerage flats around Manyata Tech Park, Hebbal/North Bangalore,
Indiranagar, and HSR Layout — built so you don't have to manually scroll
through dozens of Telegram/Facebook/WhatsApp flat groups and listing sites
every time.

**Where real data comes from, honestly:**

- **Automated, no login required:** a scheduled scraper reads Telegram's own
  *public* channel previews (`t.me/s/<channel>`) — plain public web pages,
  same as any browser gets with no account — and pulls out matching
  no-brokerage posts automatically. See
  [Auto-importing from Telegram](#auto-importing-from-telegram-public-channels-verified-working)
  below. This is the main source of real, current listings.
- **Manual capture, made fast:** Facebook groups and WhatsApp don't expose
  anything like Telegram's public preview — reading them any other way means
  either an authenticated account automating against the platform's own
  Terms of Service (real ban risk to your real number/account) or a
  maintained third party. Neither is worth the risk here, so instead this
  repo ships a [Chrome extension](#chrome-extension-facebook--whatsapp-web--anywhere)
  and a [mobile share target](#mobile-android-share-sheet) that turn "I just
  saw a post" into a saved, structured listing in one action — you're still
  the one reading the group, same as always, this just removes the retyping.
- **NoBroker (optional, unverified):** see
  [Auto-importing NoBroker listings](#auto-importing-nobroker-listings-via-apify-optional--needs-verification)
  — this one still needs you to verify it against a real Apify account before
  trusting it.

## How it works

- Filters by BHK, furnishing, max rent, max distance from Manyata, and
  brokerage-free; sortable by distance/rent/recency.
- **+ Add a listing** lets you log something you spotted in a group in about
  15 seconds — paste the raw post text into the box at the top of the form
  and the rest of the fields auto-fill (same parser the extension and mobile
  share target use), then you just review and save.
- Two modes for where listings live:
  - **No backend configured (default):** listings come from `data/listings.json`
    (empty by default — this app does not ship with fake/sample data) plus
    anything you add, saved only in your own browser via `localStorage`.
  - **Shared backend configured (recommended, see below):** listings come from
    a Firebase Realtime Database everyone (and every capture surface —
    extension, mobile share, scrapers) reads and writes to — real shared data
    instead of per-browser storage. **Set this up first** — the extension,
    mobile share target, and both scrapers all need it to have anywhere to
    save to.

## Running it locally

No build step or install needed — it's static HTML/CSS/JS.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Setting up the shared backend (Firebase Realtime Database)

This turns the app from "sample data + your own browser" into "one shared,
live list everyone you invite can read and add to" — on your own free Google
account, genuinely free forever at this scale (not a one-time credit).

This used to be a Google Sheet fronted by an Apps Script Web App — that
approach was dropped because Apps Script's per-script "deploy as web app"
authorization flow is fragile (it's known to loop/fail for some accounts and
browser configurations) and there's no way to fix that from outside your own
browser session. Firebase's project-level setup doesn't hit that flow at all.

1. Go to [console.firebase.google.com](https://console.firebase.google.com),
   sign in, **Create a project** (any name), skip Google Analytics if asked.
2. Left sidebar → **Build → Realtime Database → Create Database**. Pick any
   location, choose **Start in test mode**, click **Enable**.
3. Click the **Rules** tab, replace the contents with:
   ```json
   {
     "rules": {
       ".read": true,
       ".write": true
     }
   }
   ```
   Click **Publish**. (Firebase's default test-mode rules expire after 30
   days — this makes it permanent. There's no login/auth on reads or writes
   this way, which is fine for a small personal tool like this but worth
   knowing: anyone with the URL can write to it.)
4. Back on the **Data** tab, copy the URL shown near the top — looks like
   `https://your-project-default-rtdb.firebaseio.com`.
5. Paste that URL into `config.js` in this repo:
   ```js
   const CONFIG = {
     FIREBASE_DB_URL: "https://your-project-default-rtdb.firebaseio.com",
   };
   ```
6. Commit and push. The site will now read and write listings from that
   database — reload the page and the "+ Add a listing" form will save
   straight to it for everyone.

To let other people (flatmates, friends) contribute, just share the site URL
with them — the "+ Add a listing" button already writes to the same shared
database. You can also browse/edit the data directly from the **Data** tab in
the Firebase console.

### Listing fields

| Field | Description |
|---|---|
| `title` | Short description |
| `locality` | Area name (e.g. Hebbal, Nagawara, Thanisandra) |
| `distanceKm` | Approx. distance from Manyata Tech Park |
| `bhk` | Number of bedrooms |
| `furnishing` | `full`, `semi`, or `none` |
| `rent` | Monthly rent in ₹ |
| `deposit` | Security deposit in ₹ |
| `brokerage` | `true`/`false` |
| `contact` | Who to contact |
| `source` | Where you found it (group name, site) |
| `link` | URL to the original post, if any |
| `notes` | Anything else worth remembering |

## Chrome extension (Facebook, WhatsApp Web, anywhere)

Lives in [`extension/`](extension/). It does not scrape anything in the
background — it only acts on text you've already selected on a page you're
already looking at, which is why it's fine for Facebook and WhatsApp Web even
though an automated background scraper against either would not be.

**Install (unpacked, since it's not published to the Chrome Web Store):**

1. Go to `chrome://extensions`, turn on **Developer mode** (top right).
2. Click **Load unpacked**, select this repo's `extension/` folder.
3. Click the FlatFinder icon in your toolbar → **Settings** → paste your
   Firebase Database URL (same one from `config.js`) → **Save settings**.

**Use it:**

- Select a post's text on any page (a Facebook group, WhatsApp Web, a listing
  site) → right-click → **Save selection to FlatFinder** → the popup opens
  with fields already parsed out (locality, BHK, rent, contact, etc.) →
  review/edit → **Save**.
- Or just click the toolbar icon any time and paste text into the box at the
  top — same parsing, for when a right-click isn't convenient.
- Fields the parser wasn't confident about are highlighted so you know what
  to double check before saving.

## Mobile (Android share sheet)

The site is installable as a PWA, which adds it to Android's native **Share**
menu — share a post straight from the WhatsApp, Facebook, or Telegram app
without switching apps or retyping anything:

1. Open the site on your phone in Chrome → menu → **Add to Home screen** /
   **Install app**.
2. In WhatsApp/Facebook/Telegram, open a post → **Share** → **FlatFinder**.
3. A page opens with fields already parsed from the shared text → review →
   **Save listing**.

This needs the shared Firebase backend below configured (it saves straight to
the database, there's no per-device local mode here). iOS Safari
doesn't support share targets for installed web apps the way Android does —
on iPhone, copy the post text and paste it into the **+ Add a listing** paste
box on the main site instead; same parser, one extra tap.

## Auto-importing from Telegram public channels (verified working)

Lives in [`scripts/scrape_telegram.py`](scripts/scrape_telegram.py), run on a
schedule by [`.github/workflows/scrape-telegram.yml`](.github/workflows/scrape-telegram.yml).

**What it reads and why that's fine:** Telegram *channels* (not groups) with
public previews enabled serve their recent messages at `t.me/s/<channel>` —
a plain, unauthenticated HTML page, the same thing you'd see visiting that
URL in an incognito browser with no Telegram account at all. No Bot API
token, no MTProto client, no login. This script just fetches that public
page and parses it — the markup it looks for
(`data-post="channel/id"` on each message,
`class="tgme_widget_message_text"` for the body) was checked against a live
fetch before this was written, not guessed.

It only saves a post if it (a) mentions one of the target localities and
(b) explicitly says "no brokerage" (or equivalent) in the text — posts that
don't say either are skipped rather than assumed.

**Default channels:** `HousingBangalore` and `housingourbengaluru` — both
confirmed working (each returned real, current, correctly-parsed listings
with owner WhatsApp numbers when this was tested). Note the difference
between **channels** (public preview works) and **groups** (it doesn't —
`t.me/s/<name>` for a group redirects instead of showing content, since
reading a group requires actually joining it, which this script deliberately
doesn't do). Before adding another name to `TG_CHANNELS`, confirm it's a
channel:
```bash
curl -sI https://t.me/s/<name> | head -1   # 200 = channel, works. 302 = group, won't.
```

**Setup:**

1. Set up the shared Firebase backend above first — this scraper needs
   somewhere to save to.
2. In this repo's **Settings → Secrets and variables → Actions**, add secret
   `FIREBASE_DB_URL` (the same URL from `config.js`).
3. Optionally add repo variable `TG_CHANNELS` (comma-separated channel
   usernames) to use a different list than the default above.
4. Test it manually first: **Actions → Scrape public Telegram channels → Run
   workflow**, with "Dry run" checked — check the logs for what it found.
5. Once happy, it runs automatically every 30 minutes (free — no paid API
   involved, unlike the NoBroker one below). Change the `cron` line in the
   workflow file to adjust frequency.

## Auto-importing NoBroker listings (via Apify, optional, needs verification)

NoBroker itself has no public API, and its site couldn't be inspected directly
while building this (network access was blocked in that environment), so
rather than guess at scraping it blind, this uses **Apify's existing NoBroker
scraper actor** as a maintained third party that already solved that problem.
A scheduled GitHub Actions workflow calls it, filters for what you care
about, and pushes new listings into the same shared Firebase database — so
they show up in the app alongside everything else.

**Before relying on this, verify it actually works** — the exact input
parameters and output field names for the Apify actor were not directly
observable either, so `scripts/scrape_nobroker.py` makes a best-effort guess
(see the comments at the top of that file). To check/fix it:

1. Sign up at [apify.com](https://apify.com) (has a free usage tier) and find
   the NoBroker scraper actor (search "NoBroker" in the Apify Store). Note its
   exact actor ID from the URL or its "API" tab.
2. Open its **Input** tab to see the real input schema, and its **Runs →
   Dataset** on a past run to see real output field names. Update
   `APIFY_INPUT` and `FIELD_CANDIDATES` in `scripts/scrape_nobroker.py` to
   match if they differ from the guesses there.
3. In this repo's **Settings → Secrets and variables → Actions**:
   - Add secret `APIFY_TOKEN` (from your Apify account's Integrations page).
   - Add secret `FIREBASE_DB_URL` (the same URL from `config.js` — you've
     likely already added this for the Telegram scraper above).
   - Optionally add repo variable `APIFY_ACTOR_ID` if it differs from the
     `parseforge~nobroker-scraper` default guessed in the script.
4. Test it manually first: **Actions → Scrape NoBroker listings → Run
   workflow**, with "Dry run" checked. Check the logs — it prints a raw
   sample item and how many it could normalize. Fix `FIELD_CANDIDATES` and
   re-run until normalization looks right, *then* uncheck dry run.
5. Once confirmed, it runs automatically every 2 hours (edit the `cron` line
   in `.github/workflows/scrape-nobroker.yml` to change the frequency — keep
   it infrequent, each run costs Apify usage credits).

## Telegram notifications (removed, needs rebuilding)

This used to work by way of the Apps Script backend (a server-side function
ran on every new row and pinged a Telegram bot). Now that the backend is a
plain Firebase database with no server code attached, there's nothing to
trigger that ping automatically anymore — dropped for now rather than shipped
half-working. Options if this is wanted back: a lightweight polling script
(GitHub Actions, checks for new entries every few minutes and calls the
Telegram Bot API directly), or Firebase Cloud Functions (needs the paid
"Blaze" plan, which still has a genuine free tier under real usage but does
require adding a billing method).

## Ideas for later

- Add a "contacted" / "visited" status per listing to track your own progress.
- Auto-calculate `distanceKm` from a typed locality via a maps/geocoding API
  instead of estimating it by hand.
- Look into whether 99acres/MagicBricks offer a similar Apify actor or
  official partner API worth adding alongside NoBroker.
- Find more public (not group) Telegram channels for Indiranagar/HSR
  specifically and add them to `TG_CHANNELS` — the current defaults skew
  North Bangalore.
- Publish the extension to the Chrome Web Store instead of load-unpacked, if
  it ends up getting used enough to be worth the review process.
