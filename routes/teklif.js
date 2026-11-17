// Teklif ver, cevapla, listele
const express = require('express');
const db = require('../lib/db');
const h = require('../lib/helpers');
const teklif = require('../lib/teklif');
const { rateLimit } = require('../lib/security');

const router = express.Router();
const listing = db.prepare('SELECT * FROM listings WHERE id = ?');
const tl = (v) => { const n = parseInt(String(v || '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : null; };

router.post('/ilan/:id/teklif', h.requireLogin, h.requireVerified, rateLimit('teklif', 20, 60), h.verifyCsrf, (req, res, next) => {
  const l = listing.get(parseInt(req.params.id, 10) || 0);
  if (!l) return next();
  const err = teklif.ver(req.user, l, {
    kind: req.body.kind, amount: tl(req.body.amount), swapId: parseInt(req.body.swap_listing_id, 10) || 0, note: h.str(req.body.note, 300),
  });
  h.flash(req, err ? 'error' : 'success', err || 'Teklifin satıcıya iletildi. Cevap verince sana haber vereceğiz. 🤝');
  res.redirect(h.ilanUrl(l) + '#teklif');
});

router.post('/teklif/:id/:islem', h.requireLogin, rateLimit('teklif-cevap', 60, 60), h.verifyCsrf, (req, res) => {
  const islem = ['kabul', 'red', 'karsi', 'iptal'].includes(req.params.islem) ? req.params.islem : '';
  const id = parseInt(req.params.id, 10) || 0;
  const r = teklif.cevapla(req.user, id, islem, tl(req.body.amount));
  h.flash(req, r.hata ? 'error' : 'success', r.hata || r.ok);
  const o = db.prepare('SELECT buyer_id FROM offers WHERE id = ?').get(id);
  res.redirect(o && o.buyer_id === req.user.id ? '/tekliflerim?sekme=giden' : '/tekliflerim');
});

router.get('/tekliflerim', h.requireLogin, (req, res) => {
  res.render('offers', {
    title: 'Tekliflerim', gelen: teklif.gelen(req.user.id), giden: teklif.giden(req.user.id),
    DURUMLAR: teklif.DURUMLAR, sekme: req.query.sekme === 'giden' ? 'giden' : 'gelen', noindex: true,
  });
});

module.exports = router;
