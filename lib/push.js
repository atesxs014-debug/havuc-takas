// Telefona / tarayıcıya anlık bildirim (Web Push). Site kapalıyken de bildirim gelir.
// VAPID anahtarları .env'de yoksa bir kez üretilip veritabanında saklanır.
const webpush = require('web-push');
const db = require('./db');
const config = require('./config');

let hazir = null;
function anahtarlar() {
  if (hazir) return hazir;
  let pub = process.env.VAPID_PUBLIC_KEY || db.setting('vapid_public');
  let priv = process.env.VAPID_PRIVATE_KEY || db.setting('vapid_private');
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    pub = k.publicKey; priv = k.privateKey;
    db.setSetting('vapid_public', pub);
    db.setSetting('vapid_private', priv);
  }
  const subject = process.env.VAPID_SUBJECT || (config.CONTACT_EMAIL ? 'mailto:' + config.CONTACT_EMAIL : config.SITE_URL || 'mailto:destek@havuctakas.local');
  webpush.setVapidDetails(subject.startsWith('http') || subject.startsWith('mailto:') ? subject : 'mailto:' + subject, pub, priv);
  hazir = { pub };
  return hazir;
}

const publicKey = () => anahtarlar().pub;

const q = {
  ins: db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`),
  del: db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?'),
  delUser: db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?'),
  forUser: db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?'),
};

/** Tarayıcıdan gelen aboneliği kaydeder; geçersizse false */
function abone(userId, sub) {
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000) return false;
  const k = sub.keys || {};
  if (typeof k.p256dh !== 'string' || typeof k.auth !== 'string' || k.p256dh.length > 200 || k.auth.length > 100) return false;
  if (q.count.get(userId).n >= 10) {
    db.prepare('DELETE FROM push_subscriptions WHERE id = (SELECT MIN(id) FROM push_subscriptions WHERE user_id = ?)').run(userId);
  }
  q.ins.run(userId, sub.endpoint, k.p256dh, k.auth);
  return true;
}

function iptal(userId, endpoint) { q.delUser.run(String(endpoint || ''), userId); }
const aboneMi = (userId) => q.count.get(userId).n > 0;

/** Kullanıcının tüm cihazlarına bildirim yollar (arka planda, hata siteyi durdurmaz) */
function gonder(userId, { title = 'Havuç Takas', body, url = '/' }) {
  const subs = q.forUser.all(userId);
  if (!subs.length || process.env.PUSH_DISABLED === '1') return;
  anahtarlar();
  const payload = JSON.stringify({ title, body: String(body).slice(0, 200), url });
  for (const s of subs) {
    webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 3600 })
      .catch((e) => {
        if (e.statusCode === 404 || e.statusCode === 410) q.del.run(s.endpoint); // abonelik artık yok
        else console.error('Push gönderilemedi:', e.statusCode || e.message);
      });
  }
}

module.exports = { publicKey, abone, iptal, aboneMi, gonder };
