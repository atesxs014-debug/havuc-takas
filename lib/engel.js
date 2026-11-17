// Kullanıcı engelleme (mesajlaşma)
const db = require('./db');

const q = db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?');
const between = db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)');
const add = db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)');
const del = db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?');
const list = db.prepare(`SELECT b.blocked_id AS id, u.name, b.created_at FROM blocks b JOIN users u ON u.id = b.blocked_id
  WHERE b.blocker_id = ? ORDER BY b.created_at DESC`);

module.exports = {
  engelledi: (a, b) => !!q.get(a, b),
  arasinda: (a, b) => !!between.get(a, b, b, a),
  engelle: (a, b) => add.run(a, b),
  kaldir: (a, b) => del.run(a, b),
  liste: (a) => list.all(a),
};
