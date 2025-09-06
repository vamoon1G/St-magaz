import Database from 'better-sqlite3';

const db = new Database('data.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    unit TEXT DEFAULT 'шт',
    category TEXT,
    brand TEXT,
    stock INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

export const queries = {
  getByBarcode: db.prepare('SELECT * FROM products WHERE barcode = ?'),
  search: db.prepare(`SELECT * FROM products
                      WHERE name LIKE ? OR barcode LIKE ?
                      ORDER BY updated_at DESC LIMIT 100`),
  create: db.prepare(`INSERT INTO products (barcode, name, price, unit, category, brand, stock)
                      VALUES (@barcode, @name, @price, @unit, @category, @brand, @stock)`),
  update: db.prepare(`UPDATE products SET
                        name=@name, price=@price, unit=@unit,
                        category=@category, brand=@brand, stock=@stock,
                        updated_at=datetime('now')
                      WHERE barcode=@barcode`),
  remove: db.prepare('DELETE FROM products WHERE barcode = ?')
};