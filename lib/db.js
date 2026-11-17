const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'havuc.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER,                 -- TL, NULL ise sadece takas
  is_swap INTEGER NOT NULL DEFAULT 0,
  il TEXT NOT NULL,
  ilce TEXT NOT NULL,
  image TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', -- active | sold | removed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_listings_loc ON listings(il, ilce, status);
CREATE INDEX IF NOT EXISTS idx_listings_created ON listings(created_at);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id, read_at);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | closed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Yerel işletme reklamları: her il ve her ilçe için 4 alan (slot 1-4).
-- ilce = '' ise il geneli reklam alanıdır.
CREATE TABLE IF NOT EXISTS ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  il TEXT NOT NULL,
  ilce TEXT NOT NULL DEFAULT '',
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
  business_name TEXT NOT NULL,
  description TEXT NOT NULL,
  phone TEXT,
  website TEXT,
  address TEXT,
  image TEXT,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  months INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | active | rejected | ended
  start_date TEXT,
  end_date TEXT,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ads_slot ON ads(il, ilce, slot, status);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expires INTEGER NOT NULL
);
`);

// ---- Sürüm 2 geçişleri (mevcut veritabanlarını da günceller) ----
const migrations = [
  // 1: v2 özellikleri
  `ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE users ADD COLUMN notify_email INTEGER NOT NULL DEFAULT 1;
   ALTER TABLE listings ADD COLUMN mod_reason TEXT;
   ALTER TABLE ads ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
   ALTER TABLE ads ADD COLUMN price INTEGER;
   ALTER TABLE ads ADD COLUMN ref_code TEXT;
   ALTER TABLE ads ADD COLUMN paid INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE ads ADD COLUMN renew_months INTEGER;
   ALTER TABLE ads ADD COLUMN renew_price INTEGER;
   ALTER TABLE ads ADD COLUMN reminded INTEGER NOT NULL DEFAULT 0;
   CREATE INDEX IF NOT EXISTS idx_ads_user ON ads(user_id);

   CREATE TABLE IF NOT EXISTS tokens (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     type TEXT NOT NULL,            -- verify | reset
     token_hash TEXT NOT NULL UNIQUE,
     expires INTEGER NOT NULL,
     used INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE IF NOT EXISTS listing_images (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
     file TEXT NOT NULL,
     thumb TEXT NOT NULL,
     sort INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX IF NOT EXISTS idx_images_listing ON listing_images(listing_id, sort);
   CREATE TABLE IF NOT EXISTS favorites (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (user_id, listing_id)
   );
   CREATE TABLE IF NOT EXISTS reviews (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
     reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
     comment TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (listing_id, reviewer_id)
   );
   CREATE INDEX IF NOT EXISTS idx_reviews_seller ON reviews(seller_id);
   CREATE TABLE IF NOT EXISTS ad_stats (
     ad_id INTEGER NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
     day TEXT NOT NULL,
     impressions INTEGER NOT NULL DEFAULT 0,
     clicks INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (ad_id, day)
   );
   CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
   CREATE TABLE IF NOT EXISTS price_overrides (
     il TEXT NOT NULL, ilce TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL,
     PRIMARY KEY (il, ilce)
   );
   -- Eski tek fotoğrafları galeri tablosuna taşı
   INSERT INTO listing_images (listing_id, file, thumb, sort)
     SELECT id, image, image, 0 FROM listings WHERE image IS NOT NULL;`,

  // 2: güvenli ödemeli kargo
  `ALTER TABLE listings ADD COLUMN shipping INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE listings ADD COLUMN package_size TEXT;

   -- Satıcı ödeme bilgileri (IBAN ve TCKN şifreli saklanır)
   CREATE TABLE IF NOT EXISTS payout_accounts (
     user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     first_name TEXT NOT NULL,
     last_name TEXT NOT NULL,
     phone TEXT NOT NULL,
     address TEXT NOT NULL,
     iban_enc TEXT NOT NULL,
     iban_last4 TEXT NOT NULL,
     tckn_enc TEXT NOT NULL,
     sub_merchant_key TEXT,
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );

   CREATE TABLE IF NOT EXISTS orders (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     code TEXT UNIQUE,
     listing_id INTEGER NOT NULL REFERENCES listings(id),
     buyer_id INTEGER NOT NULL REFERENCES users(id),
     seller_id INTEGER NOT NULL REFERENCES users(id),
     title TEXT NOT NULL,
     item_price INTEGER NOT NULL,
     shipping_fee INTEGER NOT NULL,
     service_fee INTEGER NOT NULL,
     total INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'odeme_bekliyor',
       -- odeme_bekliyor | odendi | kargoda | itiraz | tamamlandi | iade | iptal
     ship_name TEXT NOT NULL,
     ship_phone TEXT NOT NULL,
     ship_il TEXT NOT NULL,
     ship_ilce TEXT NOT NULL,
     ship_address TEXT NOT NULL,
     provider TEXT NOT NULL,
     pay_token TEXT,
     payment_id TEXT,
     tx_ids TEXT,                  -- ödeme kalemlerinin işlem numaraları (JSON)
     carrier TEXT,
     tracking_no TEXT,
     dispute_reason TEXT,
     admin_note TEXT,
     payout_done INTEGER NOT NULL DEFAULT 0,
     reminded INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     paid_at TEXT, shipped_at TEXT, completed_at TEXT, closed_at TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id);
   CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id);
   CREATE INDEX IF NOT EXISTS idx_orders_listing ON orders(listing_id, status);
   CREATE INDEX IF NOT EXISTS idx_orders_token ON orders(pay_token);

   CREATE TABLE IF NOT EXISTS order_events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
     status TEXT NOT NULL,
     note TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );`,
];

const current = db.prepare('PRAGMA user_version').get().user_version;
for (let v = current; v < migrations.length; v++) {
  db.exec('BEGIN');
  try {
    db.exec(migrations[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Basit ayar deposu (fiyatlar vb.)
const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const putSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
db.setting = (key, def = null) => { const r = getSetting.get(key); return r ? r.value : def; };
db.setSetting = (key, value) => putSetting.run(key, value == null ? null : String(value));

module.exports = db;
