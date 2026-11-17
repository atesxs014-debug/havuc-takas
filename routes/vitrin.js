// İlan öne çıkarma (vitrin) satın alma
const express = require('express');
const db = require('../lib/db');
const h = require('../lib/helpers');
const vitrin = require('../lib/vitrin');
const { provider } = require('../lib/payments');
const { rateLimit } = require('../lib/security');

const router = express.Router();
const own = db.prepare('SELECT * FROM listings WHERE id = ? AND user_id = ?');
const ins = db.prepare('INSERT INTO featured_orders (listing_id, user_id, days, price, provider) VALUES (?, ?, ?, ?, ?)');

router.post('/ilan/:id/vitrin', h.requireLogin, h.requireVerified, rateLimit('vitrin', 20, 60), h.verifyCsrf, async (req, res, next) => {
  const l = own.get(parseInt(req.params.id, 10) || 0, req.user.id);
  if (!l) return next();
  try {
    const p = provider();
    const paket = vitrin.ayarlar().find((x) => x.gun === parseInt(req.body.gun, 10));
    if (!p) { h.flash(req, 'error', 'Vitrin şu an kapalı.'); return res.redirect(h.ilanUrl(l)); }
    if (l.status !== 'active') { h.flash(req, 'error', 'Yalnızca yayındaki ilanlar vitrine çıkarılabilir.'); return res.redirect(h.ilanUrl(l)); }
    if (!paket) { h.flash(req, 'error', 'Bir vitrin süresi seç.'); return res.redirect(h.ilanUrl(l)); }
    const id = Number(ins.run(l.id, req.user.id, paket.gun, paket.fiyat, p.name).lastInsertRowid);
    const code = 'VT' + String(id).padStart(6, '0');
    db.prepare('UPDATE featured_orders SET code = ? WHERE id = ?').run(code, id);
    const fo = vitrin.byCode(code);
    const start = await p.startPlatformCheckout(fo, { buyer: req.user, ip: req.ip, title: l.title, callbackUrl: `${h.baseUrl(req)}/vitrin/odeme-sonuc` });
    db.prepare('UPDATE featured_orders SET pay_token = ? WHERE id = ?').run(start.token, id);
    if (start.html) { req.session.payHtml = { code, html: start.html }; return res.redirect(`/vitrin/${code}/odeme`); }
    res.redirect(start.redirect || start.pageUrl);
  } catch (e) {
    console.error('Vitrin ödemesi başlatılamadı:', e.message);
    h.flash(req, 'error', 'Ödeme başlatılamadı. Lütfen biraz sonra tekrar dene.');
    res.redirect(h.ilanUrl(l));
  }
});

function mine(req) {
  const fo = vitrin.byCode(req.params.code);
  return fo && fo.user_id === req.user.id && fo.status === 'odeme_bekliyor' ? fo : null;
}

router.get('/vitrin/:code/odeme', h.requireLogin, (req, res, next) => {
  const fo = mine(req);
  const ph = req.session.payHtml;
  if (!fo || !ph || ph.code !== fo.code) return next();
  res.render('orders/pay', { title: 'Vitrin ödemesi', o: { code: fo.code, total: fo.price }, html: ph.html, noindex: true });
});

router.get('/vitrin/:code/test-odeme', h.requireLogin, (req, res, next) => {
  const fo = mine(req);
  if (!fo || fo.provider !== 'test') return next();
  res.render('orders/test-pay', { title: 'Test Ödeme', o: { code: fo.code, total: fo.price }, noindex: true });
});

router.post('/vitrin/:code/test-odeme', h.requireLogin, h.verifyCsrf, async (req, res, next) => {
  const fo = mine(req);
  if (!fo || fo.provider !== 'test') return next();
  const l = db.prepare('SELECT id, title FROM listings WHERE id = ?').get(fo.listing_id);
  if (req.body.sonuc !== 'basarili') {
    vitrin.iptal(fo);
    h.flash(req, 'error', 'Ödeme başarısız oldu (test).');
  } else {
    vitrin.odendi(fo, await provider().finishPlatformCheckout(fo.pay_token, fo));
    h.flash(req, 'success', `⭐ İlanın ${fo.days} gün boyunca vitrinde!`);
  }
  res.redirect(h.ilanUrl(l));
});

// iyzico geri dönüşü (oturum çerezi gelmez; oturuma dokunmuyoruz)
router.post('/vitrin/odeme-sonuc', rateLimit('vitrin-sonuc', 60, 10), async (req, res) => {
  const token = h.str(req.body.token, 200);
  const fo = token ? db.prepare('SELECT * FROM featured_orders WHERE pay_token = ?').get(token) : null;
  if (!fo) return res.status(404).render('error', { title: 'Ödeme bulunamadı', message: 'Ödeme sonucu bir vitrin siparişiyle eşleşmedi.' });
  const l = db.prepare('SELECT id, title FROM listings WHERE id = ?').get(fo.listing_id);
  let sonuc = fo.status === 'odendi' ? 'ok' : 'hata';
  if (fo.status === 'odeme_bekliyor') {
    try {
      const r = await provider().finishPlatformCheckout(token, fo);
      if (r.ok) { vitrin.odendi(fo, r); sonuc = 'ok'; } else vitrin.iptal(fo);
    } catch (e) {
      console.error('Vitrin ödeme sonucu alınamadı:', fo.code, e.message);
      sonuc = 'dogrulanamadi';
    }
  }
  res.redirect(303, `${h.ilanUrl(l)}?vitrin=${sonuc}`);
});

module.exports = router;
