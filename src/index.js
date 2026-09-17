import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { z } from 'zod';

export const BASE_URL = 'https://books.toscrape.com/';
export const USER_AGENT = 'PoliteBooksScraper/1.0 (+https://github.com/Bibek-Dhakal/polite-scraper)';
export const MIN_DELAY_MS = 500;
export const RawBookSchema = z.object({
  title: z.string().min(1), product_url: z.string().url(), price_text: z.string().min(1),
  availability_text: z.string().min(1), rating_text: z.string().min(1),
  description: z.string().nullable(), source_page: z.string().url(), fetched_at: z.string().datetime()
});
export const BookSchema = RawBookSchema.extend({ price_gbp: z.number().finite().nonnegative() });

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = { cache: path.join(root, 'cache'), output: path.join(root, 'output') };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const cacheName = url => crypto.createHash('sha256').update(url).digest('hex') + '.html';

export function normalizePrice(text) {
  const match = String(text).replace(',', '').match(/(\d+(?:\.\d{1,2})?)/);
  return match ? Number(match[1]) : NaN;
}
export function absoluteUrl(href, base = BASE_URL) { return new URL(href, base).href; }
export function parseRating(className = '') {
  return String(className).split(/\s+/).find(x => ['One', 'Two', 'Three', 'Four', 'Five'].includes(x)) || 'Unknown';
}
export function parseCatalogue(html, sourcePage) {
  const $ = cheerio.load(html); const books = [];
  $('article.product_pod').each((_, el) => {
    const a = $(el).find('h3 a').first();
    let productUrl = '';
    try { productUrl = absoluteUrl(a.attr('href'), sourcePage); } catch { productUrl = a.attr('href') || ''; }
    books.push({ title: a.attr('title')?.trim() || a.text().trim(), product_url: productUrl,
      price_text: $(el).find('.price_color').text().trim(), availability_text: $(el).find('.availability').text().replace(/\s+/g, ' ').trim(),
      rating_text: parseRating($(el).find('.star-rating').attr('class')), description: null, source_page: sourcePage, fetched_at: new Date().toISOString() });
  }); return books;
}
export function parseDetail(html, url, sourcePage, fallback = {}) {
  const $ = cheerio.load(html); const description = $('#product_description').next('p').text().trim();
  const rating = parseRating($('.star-rating').attr('class'));
  const raw = { ...fallback, title: $('div.product_main h1').text().trim() || fallback.title || '',
    price_text: $('.price_color').first().text().trim() || fallback.price_text || '',
    availability_text: $('.availability').first().text().replace(/\s+/g, ' ').trim() || fallback.availability_text || '',
    rating_text: rating === 'Unknown' ? fallback.rating_text || rating : rating,
    description: description || null, product_url: url, source_page: sourcePage, fetched_at: new Date().toISOString() };
  return raw;
}
async function readCache(url) {
  try { return await fs.readFile(path.join(dirs.cache, cacheName(url)), 'utf8'); } catch { return null; }
}
async function writeCache(url, html) { await fs.mkdir(dirs.cache, { recursive: true }); await fs.writeFile(path.join(dirs.cache, cacheName(url)), html); }

export function createFetcher({ timeoutMs = 15000, fetchImpl = fetch, delayMs = MIN_DELAY_MS } = {}) {
  let lastRequest = 0;
  return async function fetchPage(url, stats) {
    const cached = await readCache(url);
    if (cached !== null) { stats.cache_hits++; return { html: cached, cached: true }; }
    stats.pages_fetched++;
    let attempt = 0;
    while (true) {
      const retryWait = delayMs - (Date.now() - lastRequest); if (retryWait > 0) await sleep(retryWait);
      lastRequest = Date.now();
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, signal: controller.signal });
        if (!response.ok) { const error = new Error(`HTTP ${response.status}`); error.status = response.status; throw error; }
        const html = await response.text(); await writeCache(url, html); return { html, cached: false };
      } catch (error) {
        const retryable = error.name === 'AbortError' || error.status >= 500;
        if (retryable && attempt++ === 0) continue;
        throw error;
      } finally { clearTimeout(timer); }
    }
  };
}
export async function run({ fakeUrl = null } = {}) {
  const started = Date.now(); const stats = { pages_fetched: 0, cache_hits: 0, valid: 0, invalid: 0, failed: 0 };
  await fs.mkdir(dirs.output, { recursive: true });
  const fetchPage = createFetcher(); const failures = []; const raw = [];
  const robotsUrl = new URL('robots.txt', BASE_URL).href;
  try { await fetchPage(robotsUrl, stats); } catch (error) { stats.failed++; failures.push({ url: robotsUrl, error: error.message }); }
  for (let page = 1; page <= 3; page++) {
    const source = new URL(`catalogue/page-${page}.html`, BASE_URL).href;
    try {
      const { html } = await fetchPage(source, stats);
      const catalogue = parseCatalogue(html, source);
      for (const item of catalogue) raw.push(item);
    } catch (error) { stats.failed++; failures.push({ url: source, error: error.message }); }
  }
  const unique = [...new Map(raw.map(item => [item.product_url, item])).values()];
  const detailUrls = unique.slice(0, 60); if (fakeUrl) detailUrls.push({ product_url: fakeUrl, source_page: fakeUrl });
  const records = [];
  for (const item of detailUrls) {
    try { const { html } = await fetchPage(item.product_url, stats); records.push(parseDetail(html, item.product_url, item.source_page, item)); }
    catch (error) { stats.failed++; failures.push({ url: item.product_url, error: error.message }); }
  }
  const errors = [];
  for (const item of records) {
    const parsed = BookSchema.safeParse({ ...item, price_gbp: normalizePrice(item.price_text) });
    if (parsed.success) { stats.valid++; records[records.indexOf(item)] = parsed.data; } else { stats.invalid++; errors.push({ record: item, issues: parsed.error.issues }); }
  }
  await fs.writeFile(path.join(dirs.output, 'books.json'), JSON.stringify(records, null, 2) + '\n');
  await fs.writeFile(path.join(dirs.output, 'errors.json'), JSON.stringify(errors, null, 2) + '\n');
  const report = {
    started_at: new Date(started).toISOString(),
    duration_ms: Date.now() - started,
    pages_fetched: stats.pages_fetched,
    cache_hits: stats.cache_hits,
    valid_records: stats.valid,
    invalid_records: stats.invalid,
    failed_pages: stats.failed,
    failures
  };
  await fs.writeFile(path.join(dirs.output, 'run-report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fake = process.argv.indexOf('--fake-url'); const fakeUrl = fake >= 0 ? process.argv[fake + 1] : null;
  run({ fakeUrl }).then(report => console.log(JSON.stringify(report, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
}
