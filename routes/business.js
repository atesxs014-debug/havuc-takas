// İşletme paneli: reklam istatistikleri, içerik düzenleme, süre uzatma talebi
const express = require('express');
const db = require('../lib/db');
const h = require('../lib/helpers');
const config = require('../lib/config');
const images = require('../lib/images');
const pricing = require('../lib/pricing');
const notify = require('../lib/notify');
const ads = require('./ads');

const router = express.Router();

const myAds = db.prepare('SELECT * FROM ads WHERE user_id = ? ORDER BY id DESC');
const myAd = db.prepare('SELECT * FROM ads WHERE id = ? AND user_id = ?');
const stats = db.prepare(`SELECT day, impressions, clicks FROM ad_stats WHERE ad_id = ? AND day >= date('now','localtime','-29 days') ORDER BY day`);

router.get('/isletme', h.requireLogin, (req, res) => {
  res.render('business/index', { title: 'İşletme Paneli', reklamlar: myAds.all(req.user.id), bank: config.bank, noindex: true });
});

router.get('/isletme/reklam/:id', h.requireLogin, (req, res, next) => {
  const ad = myAd.get(parseInt(req.params.id, 10) || 0, req.user.id);
  if (!ad) return next();
  // Son 30 günü boş günlerle birlikte doldur
  const rows = Object.fromEntries(stats.all(ad.id).map((r) => [r.day, r]));
  const gunler = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
    gunler.push(rows[d] || { day: d, impressions: 0, clicks: 0 });
  }
  res.render('business/ad', {
    title: ad.business_name, ad, gunler, bank: config.bank, SURELER: ads.SURELER,
    aylik: pricing.aylik(ad.il, ad.ilce), noindex: true,
  });
});

const update = db.prepare(`UPDATE ads SET business_name = ?, description = ?, phone = ?, website = ?, address = ?, image = ?
  WHERE id = ? AND user_id = ?`);

router.post('/isletme/reklam/:id', h.requireLogin, images.parse('image', 1), h.verifyCsrf, async (req, res, next) => {
  try {
    const ad = myAd.get(parseInt(req.params.id, 10) || 0, req.user.id);
    if (!ad || ['rejected', 'ended'].includes(ad.status)) return next();
    const f = ads.readAdForm(req);
    const error = req.uploadError || ads.validateAdContent(f);
    if (error) { h.flash(req, 'error', error); return res.redirect(`/isletme/reklam/${ad.id}`); }
    let logo = ad.image;
    if (req.files.length) {
      const yeni = await images.saveLogo(req.files[0].buffer).catch(() => null);
      if (yeni) { images.remove(ad.image); logo = yeni; }
    } else if (req.body.remove_image) { images.remove(ad.image); logo = null; }
    update.run(f.business_name, f.description, f.phone || null, ads.normalizeUrl(f.website) || null, f.address || null, logo, ad.id, req.user.id);
    h.flash(req, 'success', 'Reklamınız güncellendi.');
    res.redirect(`/isletme/reklam/${ad.id}`);
  } catch (e) { next(e); }
});

router.post('/isletme/reklam/:id/uzat', h.requireLogin, h.verifyCsrf, (req, res, next) => {
  const ad = myAd.get(parseInt(req.params.id, 10) || 0, req.user.id);
  if (!ad || ad.status !== 'active') return next();
  const months = ads.SURELER.includes(parseInt(req.body.months, 10)) ? parseInt(req.body.months, 10) : 1;
  const tutar = pricing.toplam(ad.il, ad.ilce, months);
  db.prepare('UPDATE ads SET renew_months = ?, renew_price = ? WHERE id = ?').run(months, tutar, ad.id);
  notify.renewRequested({ ...ad, renew_months: months, renew_price: tutar });
  h.flash(req, 'success', `+${months} ay uzatma talebin alındı. Ödemen kontrol edilince süren uzatılacak.`);
  res.redirect(`/isletme/reklam/${ad.id}`);
});

module.exports = router;
