const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'gatopreto.db');

let _db;
function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema(_db);
  }
  return _db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      username  TEXT    NOT NULL UNIQUE,
      password  TEXT    NOT NULL,
      role      TEXT    NOT NULL DEFAULT 'viewer',  -- 'admin' | 'viewer'
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id              TEXT    PRIMARY KEY,
      name            TEXT    NOT NULL,
      price_fiscal    REAL,
      price_mgmt      REAL,
      stock_fiscal    REAL,
      stock_mgmt      REAL,
      stock_real      REAL,
      status          INTEGER NOT NULL DEFAULT 0,   -- 0=igual 1=divergente 2=só fiscal
      created_at      DATETIME DEFAULT (datetime('now')),
      updated_at      DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_images (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      url         TEXT NOT NULL,
      is_pinned   INTEGER NOT NULL DEFAULT 0,
      created_at  DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_products_name   ON products(name);
    CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
    CREATE INDEX IF NOT EXISTS idx_images_product  ON product_images(product_id);
  `);

  // Tabela de auditoria — um registro por produto, atualizado a cada mudança
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_audit (
      product_id    TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
      name          TEXT,
      stock_fiscal  REAL,
      stock_mgmt    REAL,
      stock_real    REAL,
      changed_at    DATETIME DEFAULT (datetime('now'))
    );
  `);

  // Migrações — adiciona colunas novas em bancos já existentes
  const migrations = [
    'ALTER TABLE products ADD COLUMN stock_real   REAL',
    'ALTER TABLE products ADD COLUMN fiscal_alert INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE product_audit ADD COLUMN fiscal_alert INTEGER NOT NULL DEFAULT 0',
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (e) { /* coluna já existe */ }
  }
}

module.exports = { getDb };
