const express = require('express');
const db = require('../lib/db');
const h = require('../lib/helpers');
const config = require('../lib/config');
const images = require('../lib/images');
const pricing = require('../lib/pricing');
const notify = require('../lib/notify');
const moderation = require('../lib/moderation');
const { rateLimit, turnstile } = require('../lib/security');
const { getIl, getIlce, iller, toplamIlce } = require('../lib/locations');
const { availability, SLOT_SAYISI, countClick } = require('../lib/ads');

const router = express.Router();
const SURELER = [1, 3, 6, 12];

function renderForm(res, form, extra = {}) {
  res.render('ad-form', {
    title: 'İşletmeniz İçin Reklam Verin',
    description: `Türkiye'nin 81 ili ve ${toplamIlce} ilçesinde, her bölge için 4 yerel işletme reklam alanı.`,
    form, SURELER, SLOT_SAYISI, toplamAlan: (iller.length + toplamIlce) * SLOT_SAYISI,
    gruplar: pricing.GRUPLAR, fiyatTablo: pricing.tablo(), bank: config.bank,
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

// Doluluk ve fiyat bilgisi (formdaki alan seçimi için)
router.get('/api/reklam-alanlari', (req, res) => {
  const il = getIl(h.str(req.query.il, 60));
  if (!il) return res.status(400).json({ error: 'il gerekli' });
  const ilceSlug = h.str(req.query.ilce, 60);
  const ilce = ilceSlug ? getIlce(il.slug, ilceSlug) : null;
  if (ilceSlug && !ilce) return res.status(400).json({ error: 'geçersiz ilçe' });
  const ic = ilce ? ilce.slug : '';
  res.json({
    konum: ilce ? `${ilce.ad}, ${il.ad}` : `${il.ad} (il geneli)`,
    aylik: pricing.aylik(il.slug, ic),
    alanlar: availability(il.slug, ic),
  });
});

const insertAd = db.prepare(`INSERT INTO ads (il, ilce, slot, business_name, description, phone, website, address, image,
  contact_name, contact_email, months, user_id, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const setRef = db.prepare('UPDATE ads SET ref_code = ? WHERE id = ?');
const adById = db.prepare('SELECT * FROM ads WHERE id = ?');

function normalizeUrl(u) {
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { const x = new URL(u); return ['http:', 'https:'].includes(x.protocol) && x.hostname.includes('.') ? x.toString() : null; } catch { return null; }
}

function readAdForm(req) {
  return {
    business_name: h.str(req.body.business_name, 80),
    description: h.str(req.body.description, 200),
    phone: h.str(req.body.phone, 20),
    website: h.str(req.body.website, 200),
    address: h.str(req.body.address, 200),
  };
}

function validateAdContent(f) {
  if (f.business_name.length < 2) return 'İşletme adını yazın.';
  if (f.description.length < 10) return 'Kısa bir tanıtım yazısı ekleyin (en az 10 karakter).';
  if (!f.phone && !f.website) return 'Müşterilerin ulaşması için telefon veya web sitesi ekleyin.';
  if (normalizeUrl(f.website) === null) return 'Web sitesi adresi geçersiz.';
  const hits = moderation.check(f.business_name, f.description);
  if (hits.length) return `Reklam metninde izin verilmeyen ifade var: ${hits.join(', ')}`;
  return null;
}

// Başvuru için giriş gerekir: işletme paneli ve bildirimler bu hesaba bağlanır
router.post('/reklam-ver', h.requireLogin, rateLimit('reklam', 10, 60), images.parse('image', 1), h.verifyCsrf, turnstile, async (req, res, next) => {
  try {
    const form = {
      ...readAdForm(req),
      il: h.str(req.body.il, 60),
      ilce: h.str(req.body.ilce, 60),
      slot: parseInt(req.body.slot, 10) || '',
      contact_name: h.str(req.body.contact_name, 80),
      contact_email: h.str(req.body.contact_email, 200).toLowerCase(),
      months: SURELER.includes(parseInt(req.body.months, 10)) ? parseInt(req.body.months, 10) : 1,
    };
    let error = req.uploadError || req.botError || null;
    if (!error && !getIl(form.il)) error = 'Reklamın görüneceği ili seçin.';
    else if (!error && form.ilce && !getIlce(form.il, form.ilce)) error = 'Geçersiz ilçe.';
    else if (!error && !(form.slot >= 1 && form.slot <= SLOT_SAYISI)) error = 'Reklam alanı (1-4) seçin.';
    if (!error) error = validateAdContent(form);
    if (!error && (form.contact_name.length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact_email))) error = 'İletişim adınızı ve geçerli bir e-posta girin.';
    if (!error && !req.body.kvkk) error = 'Reklam şartlarını ve KVKK metnini onaylayın.';
    if (error) return renderForm(res.status(400), form, { error });

    const logo = req.files.length ? await images.saveLogo(req.files[0].buffer).catch(() => null) : null;
    const tutar = pricing.toplam(form.il, form.ilce, form.months);
    const info = insertAd.run(form.il, form.ilce, form.slot, form.business_name, form.description, form.phone || null,
      normalizeUrl(form.website) || null, form.address || null, logo, form.contact_name, form.contact_email, form.months, req.user.id, tutar);
    const id = Number(info.lastInsertRowid);
    setRef.run(`HVC${String(id).padStart(5, '0')}`, id);
    const ad = adById.get(id);
    notify.adApplied(ad);
    res.render('ad-thanks', { title: 'Başvurunuz alındı', ad, konum: h.konumAdi(ad.il, ad.ilce) + (ad.ilce ? '' : ' (il geneli)'), bank: config.bank, noindex: true });
  } catch (e) { next(e); }
});

// Tıklama sayacı + yönlendirme
const activeAd = db.prepare("SELECT id, website, phone FROM ads WHERE id = ? AND status = 'active'");
router.get('/reklam/:id/git', (req, res, next) => {
  const ad = activeAd.get(parseInt(req.params.id, 10) || 0);
  if (!ad || !(ad.website || ad.phone)) return next();
  countClick(ad.id);
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
    return { il, toplam, dolu, bos: toplam - dolu, grup: pricing.grup(il.slug) };
  });
  res.render('ad-map', { title: 'Reklam Alanları', satirlar, SLOT_SAYISI, fiyatTablo: pricing.tablo(), gruplar: pricing.GRUPLAR });
});

module.exports = Object.assign(router, { readAdForm, validateAdContent, normalizeUrl, SURELER });
