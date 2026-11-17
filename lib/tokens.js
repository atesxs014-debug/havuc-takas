// Tek kullanımlık bağlantılar (e-posta doğrulama, şifre sıfırlama)
const crypto = require('node:crypto');
const db = require('./db');

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
const ins = db.prepare('INSERT INTO tokens (user_id, type, token_hash, expires, data) VALUES (?, ?, ?, ?, ?)');
const get = db.prepare('SELECT * FROM tokens WHERE token_hash = ? AND type = ? AND used = 0 AND expires > ?');
const use = db.prepare('UPDATE tokens SET used = 1 WHERE id = ?');
const clear = db.prepare('DELETE FROM tokens WHERE user_id = ? AND type = ?');

function create(userId, type, hours, data = null) {
  clear.run(userId, type);
  const t = crypto.randomBytes(32).toString('base64url');
  ins.run(userId, type, hash(t), Date.now() + hours * 3600000, data);
  return t;
}

/** Bağlantıyı kullanır ve { userId, data } döndürür */
function consumeRow(token, type) {
  if (typeof token !== 'string' || token.length > 100) return null;
  const row = get.get(hash(token), type, Date.now());
  if (!row) return null;
  use.run(row.id);
  return { userId: row.user_id, data: row.data };
}

function consume(token, type) {
  if (typeof token !== 'string' || token.length > 100) return null;
  const row = get.get(hash(token), type, Date.now());
  if (!row) return null;
  use.run(row.id);
  return row.user_id;
}

function peek(token, type) {
  if (typeof token !== 'string' || token.length > 100) return null;
  const row = get.get(hash(token), type, Date.now());
  return row ? row.user_id : null;
}

module.exports = { create, consume, consumeRow, peek };
