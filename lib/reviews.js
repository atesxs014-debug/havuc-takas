const db = require('./db');

// Puan verebilmek için: ilan "takas edildi/satıldı" olmalı ve iki taraf o ilan üzerinden karşılıklı mesajlaşmış olmalı
const talked = db.prepare(`SELECT
  (SELECT COUNT(*) FROM messages WHERE listing_id = :l AND sender_id = :r AND receiver_id = :s) AS a,
  (SELECT COUNT(*) FROM messages WHERE listing_id = :l AND sender_id = :s AND receiver_id = :r) AS b`);
const existing = db.prepare('SELECT * FROM reviews WHERE listing_id = ? AND reviewer_id = ?');

function canReview(listing, reviewerId) {
  if (!listing || !reviewerId || listing.user_id === reviewerId || listing.status !== 'sold') return false;
  const t = talked.get({ l: listing.id, r: reviewerId, s: listing.user_id });
  return t.a > 0 && t.b > 0;
}

const summary = db.prepare('SELECT ROUND(AVG(score), 1) AS ort, COUNT(*) AS n FROM reviews WHERE seller_id = ?');

module.exports = { canReview, existing: (l, r) => existing.get(l, r), summary: (id) => summary.get(id) };
