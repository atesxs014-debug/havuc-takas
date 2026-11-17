// Sayfa yenilemeden güncellenen sayaçlar (zil, mesaj) ve telefona bildirim abonelikleri
const express = require('express');
const db = require('../lib/db');
const h = require('../lib/helpers');
const push = require('../lib/push');
const { rateLimit } = require('../lib/security');

const router = express.Router();
const unreadMsg = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE receiver_id = ? AND read_at IS NULL');

router.get('/canli/sayac', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user) return res.status(401).json({});
  res.json({ bildirim: require('../lib/bildirim').okunmamis(req.user.id), mesaj: unreadMsg.get(req.user.id).n });
});

router.get('/push/anahtar', (req, res) => {
  if (!req.user) return res.status(401).json({});
  res.json({ key: push.publicKey(), abone: push.aboneMi(req.user.id) });
});

router.post('/push/abone', h.requireLogin, rateLimit('push', 30, 60), h.verifyCsrf, (req, res) => {
  let sub = null;
  try { sub = JSON.parse(String(req.body.sub || '')); } catch {}
  if (!push.abone(req.user.id, sub)) return res.status(400).json({ hata: 'Abonelik geçersiz.' });
  res.json({ ok: true });
});

router.post('/push/iptal', h.requireLogin, h.verifyCsrf, (req, res) => {
  push.iptal(req.user.id, req.body.endpoint);
  res.json({ ok: true });
});

module.exports = router;
