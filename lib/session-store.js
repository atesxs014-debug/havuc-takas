// express-session için küçük SQLite oturum deposu (ek bağımlılık gerektirmez)
const session = require('express-session');
const db = require('./db');

const get = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires > ?');
const set = db.prepare('INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires');
const del = db.prepare('DELETE FROM sessions WHERE sid = ?');
const touch = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');
const purge = db.prepare('DELETE FROM sessions WHERE expires <= ?');

const ttl = (sess) => (sess && sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000);

class SqliteStore extends session.Store {
  constructor() {
    super();
    setInterval(() => purge.run(Date.now()), 3600000).unref();
  }
  get(sid, cb) {
    try { const row = get.get(sid, Date.now()); cb(null, row ? JSON.parse(row.sess) : null); } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try { set.run(sid, JSON.stringify(sess), ttl(sess)); cb && cb(null); } catch (e) { cb && cb(e); }
  }
  destroy(sid, cb) {
    try { del.run(sid); cb && cb(null); } catch (e) { cb && cb(e); }
  }
  touch(sid, sess, cb) {
    try { touch.run(ttl(sess), sid); cb && cb(null); } catch (e) { cb && cb(e); }
  }
}

module.exports = SqliteStore;
