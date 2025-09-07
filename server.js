import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import { queries, extCache } from './db.js';
import https from 'node:https';
import http from 'node:http';
import { URL as NodeURL } from 'node:url';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- EAN‑DB config overrides (paste your JWT here if you prefer not to use .env) ----
// Example: const EANDB_JWT_HARDCODED = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
const EANDB_JWT_HARDCODED = 'eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiIzYTE4YTZlZC0yNmY5LTQ4NzQtOWU4ZS05NjFkNGU1MDcwN2MiLCJpc3MiOiJjb20uZWFuLWRiIiwiaWF0IjoxNzU3MjU1OTU3LCJleHAiOjE3ODg3OTE5NTcsImlzQXBpIjoidHJ1ZSJ9.3hk7jkz1Dr1L3Nx_Gn_x43d3rPZG4gz9aqam_jvMgtdo9lOPH4GdcXagOQOpQftYFWokQLQWEOuuqX99CTp69A';
// Optionally override base URL (usually not needed): e.g. 'https://ean-db.com/api/v2'
const EANDB_BASE_URL_HARDCODED = '';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// FIX: serve static files (CSS/JS/HTML) from /public
app.use(express.static(path.join(__dirname, 'public')));
// Also serve assets explicitly (optional as above already covers it)
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' }
}));

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  const wantsJson = req.headers['accept']?.includes('application/json') || req.path.startsWith('/api');
  return wantsJson ? res.status(401).json({ error: 'auth_required' }) : res.redirect('/login');
}

// Pages
app.get('/', (req, res) => res.redirect('/scanner'));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/scanner', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'scanner.html')));
app.get('/search', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'search.html')));
app.get('/product/:barcode', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'product.html')));

// Auth API
app.post('/api/login', (req, res) => {
  const { login, password } = req.body;
  if (login === process.env.LOGIN && password === process.env.PASSWORD) {
    req.session.user = { login };
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, error: 'Неверный логин или пароль' });
});
app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

// Products API
app.get('/api/products', requireAuth, (req, res) => {
  const { barcode, q } = req.query;
  try {
    if (barcode) {
      const item = queries.getByBarcode.get(barcode);
      return res.json({ ok: true, data: item || null });
    }
    const term = `%${q || ''}%`;
    const list = queries.search.all(term, term);
    res.json({ ok: true, data: list });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/categories', requireAuth, (req, res) => {
  try {
    const rows = queries.listCategoriesDistinct.all();
    res.json({ ok: true, data: rows.map(r => r.category) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/brands', requireAuth, (req, res) => {
  try {
    const rows = queries.listBrandsDistinct.all();
    res.json({ ok: true, data: rows.map(r => r.brand) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/products', requireAuth, (req, res) => {
  const { barcode, name, price, created_at, category, brand, stock } = req.body;
  if (!barcode || !name || price == null) return res.status(400).json({ error: 'barcode, name, price обязательны' });
  try {
    const result = queries.create.run({
      barcode: String(barcode).trim(),
      name: String(name).trim(),
      price: Number(price),
      unit: 'шт',
      category: category || null,
      brand: brand || null,
      stock: Number.isFinite(Number(stock)) ? Number(stock) : 0,
      created_at: created_at || new Date().toISOString().slice(0,10)
    });
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.put('/api/products/:barcode', requireAuth, (req, res) => {
  const { barcode } = req.params;
  const { name, price, category, brand, stock, created_at } = req.body;
  try {
    const existing = queries.getByBarcode.get(barcode);
    if (!existing) return res.status(404).json({ error: 'Не найден' });
    queries.update.run({
      barcode,
      name: name ?? existing.name,
      price: price ?? existing.price,
      unit: existing.unit,
      category: category ?? existing.category,
      brand: brand ?? existing.brand,
      stock: stock ?? existing.stock,
      created_at: created_at ?? existing.created_at
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete('/api/products/:barcode', requireAuth, (req, res) => {
  try { queries.remove.run(req.params.barcode); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Bulk delete products by barcodes array
app.post('/api/products/bulk-delete', requireAuth, (req, res) => {
  try {
    const barcodes = Array.isArray(req.body?.barcodes) ? req.body.barcodes.map(String) : [];
    if (!barcodes.length) return res.status(400).json({ ok: false, error: 'no_barcodes' });
    let deleted = 0;
    for (const bc of barcodes) {
      try { queries.remove.run(bc); deleted++; } catch {}
    }
    res.json({ ok: true, deleted });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// External product lookup by barcode
app.get('/api/lookup', requireAuth, async (req, res) => {
  const barcode = String(req.query.barcode||'').trim();
  if (!barcode) return res.status(400).json({ ok:false, error: 'barcode_required' });
  try {
    const digits = String(barcode).replace(/\D/g,'');
    console.log('[lookup] request', { barcode, digits });
    const attempts = [];
    // 1) cache hit on original
    const cached = extCache.get.get(digits);
    if (cached) return res.json({ ok: true, cached: true, data: { ...mapCacheRow(cached), usedBarcode: digits }, attempts: [{ source:'cache', candidate: digits, matched: true }] });

    // 2) Generate GTIN candidates (handle leading zeros / GTIN-14 padding)
    const cands = new Set([digits]);
    if (digits.length === 11) cands.add('0'+digits); // common UPC without leading 0
    for (const L of [12,13,14]) if (digits.length < L) cands.add(digits.padStart(L,'0'));

    let found = null; let used = null; let foundRaw = null;
    for (const cand of cands) {
      // Only EAN-DB as requested
      let result = null; let raw = null; let meta = null; const source = 'ean-db';
      ({ mapped: result, raw, meta } = await lookupEanDb(cand));
      attempts.push({ candidate: cand, ...meta, matched: !!result, raw });
      if (result) {
        // cache under candidate and original
        const cacheRow = {
          barcode: cand,
          source,
          json: JSON.stringify(raw||{}),
          name: result.name || null,
          brand: result.brand || null,
          category: result.category || null,
          image: result.image || null
        };
        extCache.upsert.run(cacheRow);
        if (cand !== digits) extCache.upsert.run({ ...cacheRow, barcode: digits });
        found = { ...result, source };
        used = cand;
        foundRaw = raw;
        console.log('[lookup]', digits, '→', source, 'used', cand, result);
        break;
      }
    }

    if (found) return res.json({ ok: true, cached: false, data: { ...found, usedBarcode: used }, attempts, debug: { raw: foundRaw } });
    return res.json({ ok: true, cached: false, data: null, attempts });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

function mapCacheRow(row){
  return { name: row.name, brand: row.brand, category: row.category, image: row.image, source: row.source };
}

async function lookupGoogleBooks(isbn){
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`;
  try {
    const r = await fetch(url);
    const status = r.status; const ok = r.ok;
    const j = await r.json();
    const item = j.items?.[0];
    const v = item?.volumeInfo;
    if (!v) return { mapped:null, raw:j, meta:{ source:'google_books', url, status, ok } };
    const mapped = {
      name: v.title || null,
      brand: (v.publisher || v.authors?.[0]) || null,
      category: v.categories?.[0] || 'Книги',
      image: v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || null
    };
    return { mapped, raw:j, meta:{ source:'google_books', url, status, ok } };
  } catch (e) { return { mapped:null, raw:{ error: String(e) }, meta:{ source:'google_books', url, ok:false, error:String(e) } }; }
}

// Removed food sources per request

async function lookupGS1RU(gtin){
  // Scrape GS1 Russia search site for basic product info using JSON-LD or meta tags
  const headers = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Encoding': 'identity',
    'Accept-Language': 'ru,en;q=0.9'
  };
  // Order matters: direct product page works as https://search.gs1ru.org/<gtin>
  const tryUrls = [
    `https://search.gs1ru.org/${encodeURIComponent(gtin)}`,
    `https://search.gs1ru.org/ru/${encodeURIComponent(gtin)}`,
    `https://search.gs1ru.org/ru/gtin/${encodeURIComponent(gtin)}`,
    `https://search.gs1ru.org/ru/search?query=${encodeURIComponent(gtin)}`
  ];
  for (const url of tryUrls) {
    try {
      const r = await getText(url, headers);
      const status = r.status; const ok = r.ok;
      if (!ok || !r.body) continue;
      const html = r.body || '';
      const mapped = extractFromHtml(html, gtin);
      if (mapped) return { mapped, raw: { url }, meta:{ source:'gs1ru', url, status, ok } };
      // if page fetched but no data, still record attempt
      return { mapped:null, raw:{ url }, meta:{ source:'gs1ru', url, status, ok } };
    } catch (e) {
      return { mapped:null, raw:{ error:String(e) }, meta:{ source:'gs1ru', url, ok:false, error:String(e) } };
    }
  }
  return { mapped:null, raw:{ error: 'gs1ru_not_found' }, meta:{ source:'gs1ru', url: tryUrls[0], ok:false, error:'not_found' } };
}

function extractFromHtml(html, gtin) {
  // Try to scope to the product-information block
  const blockMatch = html.match(/<div[^>]*id=["']product-information["'][^>]*>([\s\S]*?)<\/div>\s*<\!\-\-|<\/div>/i);
  const block = blockMatch ? blockMatch[1] : html;
  const clean = (s)=> s ? decodeHTMLEntities(String(s).replace(/<[^>]*>/g,'')).replace(/\s+/g,' ').trim() : null;

  // 1) Title in h2
  const titleMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) || html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  const name = clean(titleMatch?.[1]);

  // 2) Field pairs
  const fields = {};
  const reField = /<div class=["']field["']>\s*<div class=["']label["']>\s*([\s\S]*?)\s*<\/div>\s*<div class=["']value["']>\s*([\s\S]*?)\s*<\/div>\s*<\/div>/gi;
  let m;
  while ((m = reField.exec(block))){
    const label = clean(m[1]);
    const value = clean(m[2]);
    if (label) fields[label.toLowerCase()] = value;
  }
  let brand = fields['товарный знак'] || fields['бренд'] || null;
  if (brand) brand = brand.replace(/^\([^\)]+\)\s*/,''); // drop (ru) prefix
  const category = fields['категория gpc'] || null;

  // 3) Image if exists
  let image = null;
  const imgMatch = block.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch) {
    const src = imgMatch[1];
    if (!/placeholder/i.test(src) && !/нет данных/i.test(src)) {
      image = src.startsWith('http') ? src : `https://search.gs1ru.org${src.startsWith('/')?src:'/'+src}`;
    }
  }

  if (name || brand || category) return { name, brand, category, image };
  return null;
}

function decodeHTMLEntities(str){
  const map = { '&amp;':'&', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&#39;':'\'' };
  return str.replace(/&(?:amp|lt|gt|quot|#39);/g, m=>map[m]||m);
}

function getText(url, headers={}, timeoutMs=10000, redirects=3){
  return new Promise((resolve) => {
    try {
      const u = new NodeURL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request({
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol==='https:'?443:80),
        path: u.pathname + (u.search||''),
        method: 'GET',
        headers: { 'Connection':'close', ...headers }
      }, (res) => {
        const status = res.statusCode || 0;
        // handle redirects
        if (status >= 300 && status < 400 && res.headers.location && redirects>0) {
          const next = new NodeURL(res.headers.location, url).toString();
          res.resume();
          resolve(getText(next, headers, timeoutMs, redirects-1));
          return;
        }
        const chunks = [];
        res.on('data', (d)=> chunks.push(d));
        res.on('end', ()=>{
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({ ok: status>=200 && status<300, status, body });
        });
      });
      req.on('error', (err)=> resolve({ ok:false, status:0, error: String(err) }));
      req.setTimeout(timeoutMs, ()=>{ try{ req.destroy(new Error('timeout')); }catch{} });
      req.end();
    } catch (e) { resolve({ ok:false, status:0, error:String(e) }); }
  });
}

function findProductInJsonLd(node, gtin) {
  if (!node) return null;
  const test = (o) => {
    if (!o || typeof o !== 'object') return false;
    const t = o['@type'];
    const types = Array.isArray(t) ? t : (t ? [t] : []);
    if (!types.some(x => String(x).toLowerCase().includes('product'))) return false;
    const keys = ['gtin', 'gtin13', 'gtin12', 'gtin8', 'gtin14'];
    for (const k of keys) { if (String(o[k]||'').replace(/\D/g,'') === gtin) return true; }
    return false;
  };
  const visit = (o) => {
    if (test(o)) return o;
    if (Array.isArray(o)) { for (const x of o) { const r = visit(x); if (r) return r; } }
    else if (o && typeof o === 'object') { for (const k of Object.keys(o)) { const r = visit(o[k]); if (r) return r; } }
    return null;
  };
  return visit(node);
}

function mapJsonLdProduct(p){
  const name = p.name || p['productName'] || null;
  const image = p.image?.url || (Array.isArray(p.image) ? p.image[0] : p.image) || null;
  let brand = null;
  if (typeof p.brand === 'string') brand = p.brand;
  else if (p.brand && typeof p.brand === 'object') brand = p.brand.name || null;
  const category = p.category || p['@category'] || null;
  return { name, brand, category, image };
}

async function lookupOpenLibrary(isbn){
  const url = `https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`;
  try {
    const r = await fetch(url);
    const status = r.status; const ok = r.ok;
    const j = await r.json();
    if (!j || j.error) return { mapped:null, raw:j, meta:{ source:'openlibrary', url, status, ok } };
    const title = j.title || null;
    let publisher = null;
    if (Array.isArray(j.publishers) && j.publishers.length) publisher = j.publishers[0];
    const category = Array.isArray(j.subjects) && j.subjects.length ? j.subjects[0] : 'Книги';
    // Cover image
    let image = null;
    if (j.covers && j.covers[0]) image = `https://covers.openlibrary.org/b/id/${j.covers[0]}-L.jpg`;
    const mapped = { name: title, brand: publisher, category, image };
    return { mapped, raw:j, meta:{ source:'openlibrary', url, status, ok } };
  } catch (e) { return { mapped:null, raw:{ error: String(e) }, meta:{ source:'openlibrary', url, ok:false, error: String(e) } }; }
}

app.listen(PORT, () => console.log(`Строй Лидер v2 на http://localhost:${PORT}`));

// -------- EAN-DB integration --------
async function lookupEanDb(barcode){
  let base = (EANDB_BASE_URL_HARDCODED || process.env.EANDB_BASE_URL || 'https://ean-db.com/api/v2').replace(/\/$/, '');
  if (!/^https?:\/\//i.test(base)) {
    console.warn('[ean-db] EANDB_BASE_URL looks invalid, falling back to default:', base);
    base = 'https://ean-db.com/api/v2';
  }
  const token = (EANDB_JWT_HARDCODED || process.env.EANDB_JWT || process.env.EANDB_TOKEN || '').trim();
  const url = `${base}/product/${encodeURIComponent(barcode)}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'Accept-Language': 'ru,en;q=0.8'
  };
  if (!token || token.toLowerCase().startsWith('http') || !token.includes('.')) {
    return { mapped:null, raw:{ error: 'missing_or_invalid_token' }, meta:{ source:'ean-db', url, ok:false, status:0, error:'missing_or_invalid_token' } };
  }
  try {
    const tokenPreview = `${token.slice(0,10)}...${token.slice(-6)} (len=${token.length})`;
    console.log('[ean-db] GET', url, 'auth:', tokenPreview);
    const r = await fetch(url, { headers });
    const status = r.status; const ok = r.ok;
    let j = null;
    try { j = await r.json(); } catch {}
    console.log('[ean-db] response', { status, ok }, j);
    const prod = j?.product;
    if (!ok || !prod) return { mapped:null, raw:j || { status }, meta:{ source:'ean-db', url, status, ok } };
    const mapped = mapEanDbProduct(prod);
    return { mapped, raw:j, meta:{ source:'ean-db', url, status, ok, balance: j?.balance } };
  } catch (e) {
    console.error('[ean-db] error', e);
    return { mapped:null, raw:{ error:String(e) }, meta:{ source:'ean-db', url, ok:false, error:String(e) } };
  }
}

function mapEanDbProduct(p){
  const pickTitle = (obj)=>{
    if (!obj || typeof obj !== 'object') return null;
    return obj.ru || obj.en || Object.values(obj)[0] || null;
  };
  const name = pickTitle(p.titles) || null;
  let brand = null;
  if (Array.isArray(p.relatedBrands) && p.relatedBrands.length) {
    brand = pickTitle(p.relatedBrands[0]?.titles) || null;
  }
  if (!brand && p.manufacturer) brand = pickTitle(p.manufacturer.titles) || null;
  let category = null;
  if (Array.isArray(p.categories) && p.categories.length) category = pickTitle(p.categories[0]?.titles) || null;
  const image = Array.isArray(p.images) && p.images[0]?.url ? p.images[0].url : null;
  return { name, brand, category, image };
}
