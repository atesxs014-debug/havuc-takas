const db = require('./db');

// Puan verebilmek için: ilan "takas edildi/satıldı" olmalı ve iki taraf o ilan üzerinden karşılıklı mesajlaşmış olmalı
const talked = db.prepare(`SELECT
  (SELECT COUNT(*) FROM messages WHERE listing_id = :l AND sender_id = :r AND receiver_id = :s) AS a,
  (SELECT COUNT(*) FROM messages WHERE listing_id = :l AND sender_id = :s AND receiver_id = :r) AS b`);
const completedOrder = db.prepare("SELECT 1 FROM orders WHERE listing_id = ? AND buyer_id = ? AND status = 'tamamlandi'");
const existing = db.prepare('SELECT * FROM reviews WHERE listing_id = ? AND reviewer_id = ?');

function canReview(listing, reviewerId) {
  if (!listing || !reviewerId || listing.user_id === reviewerId || listing.status !== 'sold') return false;
  if (completedOrder.get(listing.id, reviewerId)) return true; // kargoyla satın aldı ve teslim aldı
  const t = talked.get({ l: listing.id, r: reviewerId, s: listing.user_id });
  return t.a > 0 && t.b > 0;
}

const summary = db.prepare('SELECT ROUND(AVG(score), 1) AS ort, COUNT(*) AS n FROM reviews WHERE seller_id = ?');

// Güvenilir satıcı rozeti: e-postası doğrulanmış, en az 3 değerlendirme, ortalama 4,5 ve üstü, son 90 günde haklı itiraz yok
const GUVEN = { minYorum: 3, minPuan: 4.5 };
const guvenQ = db.prepare(`SELECT u.email_verified, u.banned_at,
  (SELECT COUNT(*) FROM reviews WHERE seller_id = u.id) AS n, (SELECT AVG(score) FROM reviews WHERE seller_id = u.id) AS ort,
  (SELECT COUNT(*) FROM orders WHERE seller_id = u.id AND status = 'iade' AND closed_at > datetime('now', '-90 days')) AS iade
  FROM users u WHERE u.id = ?`);
function guvenilir(userId) {
  const r = guvenQ.get(userId);
  return !!(r && r.email_verified && !r.banned_at && r.n >= GUVEN.minYorum && r.ort >= GUVEN.minPuan && !r.iade);
}

module.exports = { GUVEN, guvenilir, canReview, existing: (l, r) => existing.get(l, r), summary: (id) => summary.get(id) };
