const express = require('express');
const fs = require('node:fs');
const db = require('../lib/db');
const h = require('../lib/helpers');
const { getIl, getIlce, iller, toplamIlce } = require('../lib/locations');
const { availability, SLOT_SAYISI } = require('../lib/ads');

const router = express.Router();

// Aylık fiyatlar .env ile ayarlanır; boşsa "teklif alın" gösterilir
const fiyatlar = {
  il: parseInt(process.env.AD_PRICE_IL, 10) || null,
  ilce: parseInt(process.env.AD_PRICE_ILCE, 10) || null,
};
const SURELER = [1, 3, 6, 12];

function renderForm(res, form, extra = {}) {
  res.render('ad-form', {
    title: 'İşletmeniz İçin Reklam Verin',
    description: `Türkiye'nin 81 ili ve ${toplamIlce} ilçesinde, her bölge için 4 yerel işletme reklam alanı.`,
    form, fiyatlar, SURELER, SLOT_SAYISI, toplamAlan: (iller.length + toplamIlce) * SLOT_SAYISI,
    ...extra,
  });
}

router.get('/reklam-ver', (req, res) => {
  const il = getIl(h.str(req.query.il, 60));
  const ilce = il ? getIlce(il.slug, h.str(req.query.ilce, 60)) : null;
  const slot = parseInt(req.query.alan, 10);
  renderForm(res, {
    il: il ? il.slug : '',
    ilce: ilce ? ilce.slug : '',
    slot: slot >= 1 && slot <= SLOT_SAYISI ? slot : '',
    months: 1,
    contact_name: req.user ? req.user.name : '',
    contact_email: req.user ? req.user.email : '',
    phone: req.user && req.user.phone ? req.user.phone : '',
  });
});

// Doluluk bilgisi (form içindeki slot seçimi için)
router.get('/api/reklam-alanlari', (req, res) => {
  const il = getIl(h.str(req.query.il, 60));
  if (!il) return res.status(400).json({ error: 'il gerekli' });
  const ilceSlug = h.str(req.query.ilce, 60);
  const ilce = ilceSlug ? getIlce(il.slug, ilceSlug) : null;
  if (ilceSlug && !ilce) return res.status(400).json({ error: 'geçersiz ilçe' });
  res.json({ konum: ilce ? `${ilce.ad}, ${il.ad}` : `${il.ad} (il geneli)`, alanlar: availability(il.slug, ilce ? ilce.slug : '') });
});

const insertAd = db.prepare(`INSERT INTO ads (il, ilce, slot, business_name, description, phone, website, address, image,
  contact_name, contact_email, months) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

function normalizeUrl(u) {
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { const x = new URL(u); return ['http:', 'https:'].includes(x.protocol) ? x.toString() : null; } catch { return null; }
}

router.post('/reklam-ver', h.uploadSingle('image'), h.verifyCsrf, (req, res) => {
  const form = {
    il: h.str(req.body.il, 60),
    ilce: h.str(req.body.ilce, 60),
    slot: parseInt(req.body.slot, 10) || '',
    business_name: h.str(req.body.business_name, 80),
    description: h.str(req.body.description, 200),
    phone: h.str(req.body.phone, 20),
    website: h.str(req.body.website, 200),
    address: h.str(req.body.address, 200),
    contact_name: h.str(req.body.contact_name, 80),
    contact_email: h.str(req.body.contact_email, 200).toLowerCase(),
    months: SURELER.includes(parseInt(req.body.months, 10)) ? parseInt(req.body.months, 10) : 1,
  };
  const website = normalizeUrl(form.website);
  let error = req.uploadError || null;
  if (!error && !getIl(form.il)) error = 'Reklamın görüneceği ili seçin.';
  else if (!error && form.ilce && !getIlce(form.il, form.ilce)) error = 'Geçersiz ilçe.';
  else if (!error && !(form.slot >= 1 && form.slot <= SLOT_SAYISI)) error = 'Reklam alanı (1-4) seçin.';
  else if (!error && form.business_name.length < 2) error = 'İşletme adını yazın.';
  else if (!error && form.description.length < 10) error = 'Kısa bir tanıtım yazısı ekleyin (en az 10 karakter).';
  else if (!error && !form.phone && !form.website) error = 'Müşterilerin ulaşması için telefon veya web sitesi ekleyin.';
  else if (!error && website === null) error = 'Web sitesi adresi geçersiz.';
  else if (!error && (form.contact_name.length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact_email))) error = 'İletişim adınızı ve geçerli bir e-posta girin.';
  else if (!error && !req.body.kvkk) error = 'Reklam şartlarını ve KVKK metnini onaylayın.';

  if (error) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return renderForm(res.status(400), form, { error });
  }
  insertAd.run(form.il, form.ilce, form.slot, form.business_name, form.description, form.phone || null, website || null,
    form.address || null, req.file ? req.file.filename : null, form.contact_name, form.contact_email, form.months);
  res.render('ad-thanks', { title: 'Başvurunuz alındı', konum: h.konumAdi(form.il, form.ilce) + (form.ilce ? '' : ' (il geneli)'), form });
});

// Tıklama sayacı + yönlendirme
const adById = db.prepare("SELECT id, website, phone FROM ads WHERE id = ? AND status = 'active'");
const click = db.prepare('UPDATE ads SET clicks = clicks + 1 WHERE id = ?');
router.get('/reklam/:id/git', (req, res, next) => {
  const ad = adById.get(parseInt(req.params.id, 10) || 0);
  if (!ad || !(ad.website || ad.phone)) return next();
  click.run(ad.id);
  res.redirect(ad.website || 'tel:' + ad.phone.replace(/[^\d+]/g, ''));
});

// Tüm Türkiye reklam alanı doluluk özeti
const doluluk = db.prepare(`SELECT il, SUM(ilce = '') AS il_dolu, SUM(ilce != '') AS ilce_dolu
  FROM ads WHERE status = 'active' GROUP BY il`);
router.get('/reklam-alanlari', (req, res) => {
  const map = Object.fromEntries(doluluk.all().map((r) => [r.il, r]));
  const satirlar = iller.map((il) => {
    const r = map[il.slug] || { il_dolu: 0, ilce_dolu: 0 };
    const toplam = (il.ilceler.length + 1) * SLOT_SAYISI;
    const dolu = (r.il_dolu || 0) + (r.ilce_dolu || 0);
    return { il, toplam, dolu, bos: toplam - dolu };
  });
  res.render('ad-map', { title: 'Reklam Alanları', satirlar, SLOT_SAYISI });
});

module.exports = router;
