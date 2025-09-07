import Database from 'better-sqlite3';

const db = new Database('data.db');

db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    unit TEXT DEFAULT 'шт',
    category TEXT,
    brand TEXT,
    stock INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (date('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- cache for external lookups
  CREATE TABLE IF NOT EXISTS ext_cache (
    barcode TEXT PRIMARY KEY,
    source TEXT,
    json TEXT,
    name TEXT,
    brand TEXT,
    category TEXT,
    image TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export const queries = {
  getByBarcode: db.prepare('SELECT * FROM products WHERE barcode = ?'),
  search: db.prepare(`SELECT * FROM products
                      WHERE name LIKE ? OR barcode LIKE ?
                      ORDER BY updated_at DESC LIMIT 100`),
  listCategoriesDistinct: db.prepare(`SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category <> '' ORDER BY category COLLATE NOCASE`),
  listBrandsDistinct: db.prepare(`SELECT DISTINCT brand FROM products WHERE brand IS NOT NULL AND brand <> '' ORDER BY brand COLLATE NOCASE`),
  create: db.prepare(`INSERT INTO products (barcode, name, price, unit, category, brand, stock, created_at)
                      VALUES (@barcode, @name, @price, @unit, @category, @brand, @stock, @created_at)`),
  update: db.prepare(`UPDATE products SET
                        name=@name, price=@price, unit=@unit,
                        category=@category, brand=@brand, stock=@stock,
                        created_at=@created_at,
                        updated_at=datetime('now')
                      WHERE barcode=@barcode`),
  remove: db.prepare('DELETE FROM products WHERE barcode = ?')
};

// External cache helpers
export const extCache = {
  get: db.prepare('SELECT * FROM ext_cache WHERE barcode = ?'),
  upsert: db.prepare(`INSERT INTO ext_cache (barcode, source, json, name, brand, category, image, updated_at)
                      VALUES (@barcode, @source, @json, @name, @brand, @category, @image, datetime('now'))
                      ON CONFLICT(barcode) DO UPDATE SET
                        source=excluded.source,
                        json=excluded.json,
                        name=excluded.name,
                        brand=excluded.brand,
                        category=excluded.category,
                        image=excluded.image,
                        updated_at=datetime('now')`)
};
