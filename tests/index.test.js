import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePrice, absoluteUrl, parseCatalogue, parseDetail, nextCatalogueUrl, BookSchema, recordsToCsv, compareRecords, renderDashboard, createFetcher } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = name => fs.readFile(path.join(here, '..', 'fixtures', name), 'utf8');

test('normalizes pound prices to numbers', () => {
  assert.equal(normalizePrice('£51.99'), 51.99);
  assert.equal(normalizePrice('£1,234.50'), 1234.5);
});
test('resolves relative URLs against the source page', () => {
  assert.equal(absoluteUrl('../books/x.html', 'https://books.toscrape.com/catalogue/page-2.html'), 'https://books.toscrape.com/books/x.html');
});
test('follows the catalogue next link', () => {
  assert.equal(
    nextCatalogueUrl('<li class="next"><a href="page-2.html">next</a></li>', 'https://books.toscrape.com/catalogue/page-1.html'),
    'https://books.toscrape.com/catalogue/page-2.html'
  );
});
test('missing description is represented as null', async () => {
  const html = '<div class="product_main"><h1>Book</h1><p class="price_color">£2.00</p><p class="availability">In stock</p><p class="star-rating Two"></p></div>';
  assert.equal(parseDetail(html, 'https://books.toscrape.com/book.html', 'https://books.toscrape.com/').description, null);
});
test('catalogue parsing retains duplicate URLs for the caller to deduplicate', async () => {
  const records = parseCatalogue(await fixture('catalogue.html'), 'https://books.toscrape.com/catalogue/page-1.html');
  assert.equal(records.length, 2);
  assert.equal(new Set(records.map(record => record.product_url)).size, 1);
});
test('malformed fixture parses without crashing and is rejected by validation', async () => {
  const record = parseCatalogue(await fixture('malformed.html'), 'https://books.toscrape.com/catalogue/page-1.html')[0];
  assert.ok(record);
  assert.equal(BookSchema.safeParse({ ...record, price_gbp: normalizePrice(record.price_text) }).success, false);
});
test('detail parser prefers detail fields while retaining catalogue fallback', () => {
  const record = parseDetail('<div class="product_main"><h1>Detail title</h1><p class="price_color">£3.50</p><p class="availability"> In stock </p><p class="star-rating Five"></p><h2 id="product_description"></h2><p>Description</p></div>', 'https://books.toscrape.com/x.html', 'https://books.toscrape.com/', { title: 'Fallback' });
  assert.equal(record.title, 'Detail title');
  assert.equal(record.description, 'Description');
  assert.equal(record.rating_text, 'Five');
});
test('detail parser collapses extra whitespace and keeps missing description nullable', () => {
  const record = parseDetail('<div class="product_main"><h1>  Spaced book  </h1><p class="price_color"> £4.00 </p><p class="availability">\n In stock \n</p><p class="star-rating One"></p></div>', 'https://books.toscrape.com/x.html', 'https://books.toscrape.com/');
  assert.equal(record.title, 'Spaced book');
  assert.equal(record.availability_text, 'In stock');
  assert.equal(record.description, null);
});
test('CSV export quotes values and change detection uses stable fields', () => {
  const record = { title: 'A, book', product_url: 'https://example.test/a', price_text: '£1', price_gbp: 1, availability_text: 'In stock', rating_text: 'One', description: null, source_page: 'https://example.test/', fetched_at: '2020-01-01T00:00:00.000Z' };
  assert.match(recordsToCsv([record]), /"A, book"/);
  assert.deepEqual(compareRecords([record], [{ ...record, fetched_at: '2021-01-01T00:00:00.000Z' }]), { new: 0, changed: 0, unchanged: 1, gone: 0 });
  assert.match(renderDashboard({ records: [record], failures: [] }), /Record count: <strong>1/);
});
test('fetcher retries 5xx with structured attempts but does not retry 404', async () => {
  const events = [];
  let calls = 0;
  const fetcher = createFetcher({
    delayMs: 1, jitterMs: 0, maxRetries: 2,
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 503, headers: { get: () => '0' } };
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => '<html></html>' };
    },
    logger: event => events.push(event)
  });
  await fetcher(`https://example.test/retry-fixture-${Date.now()}.html`, { pages_fetched: 0, cache_hits: 0 });
  assert.equal(calls, 2);
  assert.equal(events.find(event => event.retrying).status, 503);
});
