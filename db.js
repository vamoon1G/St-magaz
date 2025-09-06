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
`);

export const queries = {
  getByBarcode: db.prepare('SELECT * FROM products WHERE barcode = ?'),
  search: db.prepare(`SELECT * FROM products
                      WHERE name LIKE ? OR barcode LIKE ?
                      ORDER BY updated_at DESC LIMIT 100`),
  listCategoriesDistinct: db.prepare(`SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category <> '' ORDER BY category COLLATE NOCASE`),
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