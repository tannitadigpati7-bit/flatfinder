# FlatFinder

A small, no-backend search tool for finding 1BHK fully-furnished, no-brokerage flats
near Manyata Tech Park, Bangalore — built so you don't have to manually scroll
through dozens of Facebook/WhatsApp flat groups and listing sites every time.

## How it works

- `data/listings.json` is the seed database of listings (locality, distance from
  Manyata, rent, furnishing, brokerage status, contact, source, etc).
- The page loads that seed data and lets you filter by BHK, furnishing, max rent,
  max distance, and brokerage-free, then sort by distance/rent/recency.
- When you spot a new listing in a group or on a site, click **+ Add a listing**
  to log it in a few seconds. Listings you add are saved in your browser
  (`localStorage`) so they persist between visits, without needing a server.

## Running it

No build step or install needed — it's static HTML/CSS/JS.

```bash
# from the project root
python3 -m http.server 8000
# then open http://localhost:8000
```

Or open `index.html` directly in a browser (some browsers block `fetch` on
`file://` — use the local server if the seed listings don't show up).

## Updating the shared seed data

If you want listings you find to be available on every device (not just the
browser you added them from), edit `data/listings.json` directly and commit
the change — that's the shared source of truth. Listings added via the
"+ Add a listing" form stay local to your browser only.

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

- Deploy to GitHub Pages for access from your phone.
- Add a "contacted" / "visited" status per listing to track your own progress.
- Pull listings automatically from NoBroker/99acres via their public search
  pages (would need a small scraper/backend, not included here to keep this
  simple and dependency-free).
