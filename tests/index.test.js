import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePrice, absoluteUrl, parseCatalogue, parseDetail, BookSchema } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = name => fs.readFile(path.join(here, '..', 'fixtures', name), 'utf8');

test('normalizes pound prices to numbers', () => {
  assert.equal(normalizePrice('£51.99'), 51.99);
  assert.equal(normalizePrice('£1,234.50'), 1234.5);
});
test('resolves relative URLs against the source page', () => {
  assert.equal(absoluteUrl('../books/x.html', 'https://books.toscrape.com/catalogue/page-2.html'), 'https://books.toscrape.com/books/x.html');
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
