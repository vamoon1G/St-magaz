import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { queries } from './db.js';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Примитивная авторизация по PIN для мутирующих запросов
function requirePin(req, res, next) {
  const pin = req.headers['x-admin-pin'] || req.query.pin || req.body.pin;
  if (!process.env.PIN) return res.status(500).json({ error: 'PIN не настроен на сервере' });
  if (String(pin) !== String(process.env.PIN)) return res.status(401).json({ error: 'Неверный PIN' });
  next();
}

// Получить товар по штрих-коду
app.get('/api/products', (req, res) => {
  const { barcode, q } = req.query;
  try {
    if (barcode) {
      const item = queries.getByBarcode.get(barcode);
      return res.json({ ok: true, data: item || null });
    }
    const term = `%${q || ''}%`;
    const list = queries.search.all(term, term);
    res.json({ ok: true, data: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Создать товар
app.post('/api/products', requirePin, (req, res) => {
  const { barcode, name, price, unit, category, brand, stock } = req.body;
  if (!barcode || !name || price == null) return res.status(400).json({ error: 'barcode, name, price обязательны' });
  try {
    const result = queries.create.run({
      barcode: String(barcode).trim(),
      name: String(name).trim(),
      price: Number(price),
      unit: unit || 'шт',
      category: category || null,
      brand: brand || null,
      stock: Number.isFinite(Number(stock)) ? Number(stock) : 0
    });
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Обновить товар (по штрих-коду)
app.put('/api/products/:barcode', requirePin, (req, res) => {
  const { barcode } = req.params;
  const { name, price, unit, category, brand, stock } = req.body;
  try {
    const existing = queries.getByBarcode.get(barcode);
    if (!existing) return res.status(404).json({ error: 'Не найден' });
    queries.update.run({
      barcode,
      name: name ?? existing.name,
      price: price ?? existing.price,
      unit: unit ?? existing.unit,
      category: category ?? existing.category,
      brand: brand ?? existing.brand,
      stock: stock ?? existing.stock
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Удалить товар
app.delete('/api/products/:barcode', requirePin, (req, res) => {
  try {
    queries.remove.run(req.params.barcode);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => console.log(`Строй Лидер запущен на http://localhost:${PORT}`));