# FlatFinder

A small search tool for finding 1BHK fully-furnished, no-brokerage flats near
Manyata Tech Park, Bangalore — built so you don't have to manually scroll
through dozens of Facebook/WhatsApp flat groups and listing sites every time.

**On automatic data collection:** this app does not and cannot scrape Facebook
groups or WhatsApp — neither exposes a public/legitimate API for that, and
doing so would violate their terms of service and put your account at risk.
Real listings still have to be entered by a person who saw them (you, or
anyone else you invite to contribute) — this app just makes that fast and,
once the shared backend below is set up, makes it visible to everyone instead
of staying stuck in one browser.

## How it works

- Filters by BHK, furnishing, max rent, max distance from Manyata, and
  brokerage-free; sortable by distance/rent/recency.
- **+ Add a listing** lets you log something you spotted in a group in about
  15 seconds.
- Two modes for where listings live:
  - **No backend configured (default):** listings come from `data/listings.json`
    (sample data) plus anything you add, saved only in your own browser via
    `localStorage`.
  - **Shared backend configured (recommended, see below):** listings come from
    a Google Sheet everyone can read and add to — real shared data instead of
    per-browser storage.

## Running it locally

No build step or install needed — it's static HTML/CSS/JS.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Setting up the shared backend (Google Sheets)

This turns the app from "sample data + your own browser" into "one shared,
live list everyone you invite can read and add to" — all on your own free
Google account, no third-party service involved.

1. **Create a Google Sheet** (sheets.new). Rename the first tab to `Listings`.
2. In row 1, add these exact headers, one per column:
   ```
   id  title  locality  distanceKm  bhk  furnishing  rent  deposit  brokerage  contact  source  link  notes
   ```
3. Go to **Extensions → Apps Script**. Delete the placeholder code and paste
   in the contents of [`apps-script/Code.gs`](apps-script/Code.gs) from this
   repo. Save (File → Save, or Ctrl+S).
4. Click **Deploy → New deployment**. For "Select type" choose **Web app**.
   Set:
   - Execute as: **Me**
   - Who has access: **Anyone**
   Click **Deploy**, and authorize it when prompted (it's your own script, on
   your own sheet — the warning screen is Google's standard one for any new
   Apps Script deployment).
5. Copy the **Web app URL** it gives you.
6. Paste that URL into `config.js` in this repo:
   ```js
   const CONFIG = {
     SHEET_API_URL: "https://script.google.com/macros/s/XXXXX/exec",
   };
   ```
7. Commit and push. The site will now read and write listings from that
   sheet — reload the page and the "+ Add a listing" form will save straight
   to it for everyone.

To let other people (flatmates, friends) contribute, just share the site URL
with them — the "+ Add a listing" button already writes to the same shared
sheet. You can also open the Google Sheet itself to a trusted few people if
you'd rather they edit rows directly.

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

## Auto-importing NoBroker listings (via Apify)

NoBroker itself has no public API, and its site couldn't be inspected directly
while building this (network access was blocked in that environment), so
rather than guess at scraping it blind, this uses **Apify's existing NoBroker
scraper actor** as a maintained third party that already solved that problem.
A scheduled GitHub Actions workflow calls it, filters for what you care
about, and pushes new listings into the same shared Google Sheet — so they
show up in the app and trigger the same Telegram notification as a manually
added listing.

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
   - Add secret `SHEET_API_URL` (the same Apps Script URL from `config.js`).
   - Optionally add repo variable `APIFY_ACTOR_ID` if it differs from the
     `parseforge~nobroker-scraper` default guessed in the script.
4. Test it manually first: **Actions → Scrape NoBroker listings → Run
   workflow**, with "Dry run" checked. Check the logs — it prints a raw
   sample item and how many it could normalize. Fix `FIELD_CANDIDATES` and
   re-run until normalization looks right, *then* uncheck dry run.
5. Once confirmed, it runs automatically every 2 hours (edit the `cron` line
   in `.github/workflows/scrape-nobroker.yml` to change the frequency — keep
   it infrequent, each run costs Apify usage credits).

## Telegram notifications

Once the Google Sheets backend (above) is set up, you can get pinged the
moment any new listing is added — manually via the site, or by the scraper —
instead of needing to check the page yourself:

1. Message [@BotFather](https://t.me/BotFather) on Telegram, run `/newbot`,
   and copy the bot token it gives you.
2. Message your new bot anything once (so it can message you back), then
   visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser
   and find your `chat.id` in the JSON response.
3. In the Google Sheet's **Extensions → Apps Script** editor, find the
   `setTelegramConfig_` function, paste in your bot token and chat id, select
   it in the function dropdown at the top, and click **Run** once. (This
   stores them in the script's private Script Properties — not in the sheet
   or the public repo.)
4. That's it — new rows appended to the sheet (from the web form or the
   scraper) now trigger a Telegram message automatically.

## Ideas for later

- Add a "contacted" / "visited" status per listing to track your own progress.
- Auto-calculate `distanceKm` from a typed locality via a maps/geocoding API
  instead of estimating it by hand.
- Look into whether 99acres/MagicBricks offer a similar Apify actor or
  official partner API worth adding alongside NoBroker.
