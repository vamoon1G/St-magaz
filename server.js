import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import { queries } from './db.js';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

app.listen(PORT, () => console.log(`Строй Лидер v2 на http://localhost:${PORT}`));