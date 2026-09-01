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

## Ideas for later

- Add a "contacted" / "visited" status per listing to track your own progress.
- Look into whether NoBroker/99acres/MagicBricks offer any official partner
  API for no-brokerage listings (none are known to offer public access as of
  writing — this would need direct outreach to confirm).
