# Polite Books to Scrape scraper

This is a Node.js 20+ ESM scraper for [Books to Scrape](https://books.toscrape.com),
a public educational sandbox made for scraping practice. Its `robots.txt` is
requested before crawling; the live check returned HTTP 404, so no robots file
was found. A missing robots file is not treated as permission for another site.

## Target classification

- **Target:** Books to Scrape, a practice catalogue explicitly intended for
  scraping exercises.
- **Scope:** only the first three catalogue pages and the 60 linked book pages.
- **Data:** title, product URL, price, availability, rating, description, source
  page, and fetch timestamp.
- **Why appropriate:** this sandbox exists for scraping practice and contains no
  account, login, or personal data.

I will not reuse this code on another site without checking its rules and terms first.

## Usage

```sh
npm install
npm test
npm start
```

The run fetches and caches the first three catalogue pages and their 60 unique
products. Requests identify themselves as
`PoliteBooksScraper/1.0 (+https://github.com/Bibek-Dhakal/polite-scraper)`, have a
timeout, check HTTP status, retry timeouts, 429s, and 5xx responses up to three
times using exponential backoff and small jitter, and honor `Retry-After`.
There are no retries for 403 or 404. Requests wait at least 500ms (including
retries) and cache hits do not wait. JSON-lines retry logs are written to
`logs/scraper.log`; each event includes the URL, status, attempt, and retry wait.
A page failure is isolated from the rest of the crawl.

## Optional outputs

In addition to `output/books.json`, `output/errors.json`, and
`output/run-report.json`, each run writes:

- `output/books.csv`: validated records flattened to one row. The columns are
  `title, product_url, price_text, price_gbp, availability_text, rating_text,
  description, source_page, fetched_at`; values are RFC-style CSV quoted and
  embedded quotes are doubled. Nullable descriptions become empty cells.
- `output/record-hashes.json`: the previous validated records and stable SHA-256
  hashes (the fetch timestamp is deliberately excluded). The report's
  `changes` object gives `new`, `changed`, `unchanged`, and `gone` counts.
- `output/dashboard.html`: a tiny local, self-contained dashboard with record
  count, price range, failure count, and last fresh time. Open it locally after
  `npm start`.

All cache, output, and log artifacts are ignored by Git and are never committed.

## Record schema

Each validated record contains `title`, `product_url`, `price_text`,
`price_gbp`, `availability_text`, `rating_text`, nullable `description`,
`source_page`, and ISO `fetched_at`. `product_url` and `source_page` must be
absolute URLs, and `price_gbp` must be a finite, non-negative number. Records
that fail Zod validation are written to `output/errors.json`, never
`output/books.json`.

The data is already in the HTML sent by the server, so the core assignment
needs no browser; a browser would only add cost.

## Ethics and limitations

Use an official API when one exists. Never bypass logins, paywalls, or blocks,
and collect only what you need. This scraper is intentionally limited to the
three-page Books to Scrape sandbox scope; its robots endpoint returned 404 and
does not establish permission for a different site.

For an intentional failure-isolation smoke test, append a fake detail URL:

```sh
node src/index.js --fake-url https://books.toscrape.com/does-not-exist.html
```

Generated `output/books.json`, `output/errors.json`, and `output/run-report.json`
are idempotently replaced on each run. Invalid records are excluded from
`books.json` and described in `errors.json`; records include raw fields plus
numeric `price_gbp`. The change comparison is against the immediately previous
successful output snapshot, so the first run reports all validated records as
new.

Tests cover URL and price parsing, missing descriptions, extra whitespace,
malformed selector fixtures, CSV quoting, stable change detection, and the
dashboard output. Run `npm test` for the fixture suite. `npm start` performs a
live run; the `--fake-url https://books.toscrape.com/does-not-exist.html`
option is a local failure-isolation smoke test.

## Sample run report

```json
{
  "started_at": "2026-09-17T09:00:00.000Z",
  "duration_ms": 42000,
  "pages_fetched": 64,
  "cache_hits": 0,
  "valid_records": 60,
  "invalid_records": 0,
  "failed_pages": 1,
  "failures": [
    {
      "url": "https://books.toscrape.com/robots.txt",
      "error": "HTTP 404"
    }
  ]
}
```
