// Ücretli vitrin (ilan öne çıkarma): kartla ödenir, ilan listelerde en üstte ve rozetli görünür
const db = require('./db');
const { provider } = require('./payments');
const bildirim = require('./bildirim');

const PAKETLER = [{ gun: 7, varsayilan: 99 }, { gun: 30, varsayilan: 299 }];

function ayarlar() {
  return PAKETLER.map((p) => ({ gun: p.gun, fiyat: Number(db.setting('vitrin_' + p.gun, p.varsayilan)) }));
}
function setAyarlar(b) {
  for (const p of PAKETLER) {
    const n = parseInt(String(b['vitrin_' + p.gun] || '').replace(/[^\d]/g, ''), 10);
    if (Number.isFinite(n) && n >= 1 && n <= 100000) db.setSetting('vitrin_' + p.gun, n);
  }
}

const byCode = (c) => db.prepare('SELECT * FROM featured_orders WHERE code = ?').get(c);

/** Ödeme alındı: vitrin süresini mevcut bitişin üstüne ekle */
function odendi(fo, r) {
  const cur = db.prepare('UPDATE featured_orders SET status = ?, payment_id = ?, paid_at = datetime(\'now\') WHERE id = ? AND status = \'odeme_bekliyor\'')
    .run('odendi', r.paymentId || null, fo.id);
  if (!cur.changes) return false;
  db.prepare(`UPDATE listings SET featured_until = datetime(MAX(COALESCE(featured_until, datetime('now')), datetime('now')), ?) WHERE id = ?`)
    .run(`+${fo.days} days`, fo.listing_id);
  const l = db.prepare('SELECT id, title FROM listings WHERE id = ?').get(fo.listing_id);
  bildirim.ekle(fo.user_id, `"${l.title}" ${fo.days} gün boyunca vitrinde ⭐`, `/ilan/${l.id}`, '⭐');
  return true;
}

function iptal(fo) {
  db.prepare("UPDATE featured_orders SET status = 'iptal' WHERE id = ? AND status = 'odeme_bekliyor'").run(fo.id);
}

// 1 saatten eski ödenmemiş vitrin siparişlerini kapat
function temizle() {
  db.prepare("UPDATE featured_orders SET status = 'iptal' WHERE status = 'odeme_bekliyor' AND created_at < datetime('now', '-60 minutes')").run();
}

module.exports = { PAKETLER, ayarlar, setAyarlar, byCode, odendi, iptal, temizle, acik: () => !!provider() };
