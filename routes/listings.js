const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../lib/db');
const h = require('../lib/helpers');
const { getIl, getIlce } = require('../lib/locations');
const { isKategori, getKategori } = require('../lib/categories');
const { getSlots } = require('../lib/ads');

const router = express.Router();
const SAYFA_BOYUTU = 20;

const SIRALAMA = {
  yeni: 'l.created_at DESC, l.id DESC',
  eski: 'l.created_at ASC, l.id ASC',
  'fiyat-artan': 'l.price IS NULL, l.price ASC',
  'fiyat-azalan': 'l.price IS NULL, l.price DESC',
  populer: 'l.views DESC',
};

function renderListings(req, res, preset = {}) {
  const il = getIl(preset.il || h.str(req.query.il, 60));
  const ilce = il ? getIlce(il.slug, preset.ilce || h.str(req.query.ilce, 60)) : null;
  const kategori = isKategori(req.query.kategori) ? req.query.kategori : '';
  const ara = h.str(req.query.q, 100);
  const sirala = SIRALAMA[req.query.sirala] ? req.query.sirala : 'yeni';
  const tip = ['satilik', 'takas'].includes(req.query.tip) ? req.query.tip : '';
  const sayfa = Math.max(1, parseInt(req.query.sayfa, 10) || 1);

  const where = ["l.status = 'active'"];
  const params = [];
  if (il) { where.push('l.il = ?'); params.push(il.slug); }
  if (ilce) { where.push('l.ilce = ?'); params.push(ilce.slug); }
  if (kategori) { where.push('l.category = ?'); params.push(kategori); }
  if (tip === 'satilik') where.push('l.price IS NOT NULL');
  if (tip === 'takas') where.push('l.is_swap = 1');
  if (ara) {
    where.push("(l.title LIKE ? ESCAPE '\\' OR l.description LIKE ? ESCAPE '\\')");
    const like = '%' + ara.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    params.push(like, like);
  }
  const w = where.join(' AND ');
  const toplam = db.prepare(`SELECT COUNT(*) AS n FROM listings l WHERE ${w}`).get(...params).n;
  const sayfaSayisi = Math.max(1, Math.ceil(toplam / SAYFA_BOYUTU));
  const ilanlar = db.prepare(`SELECT l.* FROM listings l WHERE ${w} ORDER BY ${SIRALAMA[sirala]} LIMIT ? OFFSET ?`)
    .all(...params, SAYFA_BOYUTU, (sayfa - 1) * SAYFA_BOYUTU);

  // Reklam alanları: ilçe seçiliyse ilçenin, sadece il seçiliyse ilin 4 alanı
  const reklamlar = il ? getSlots(il.slug, ilce ? ilce.slug : '', { countImpression: true }) : null;

  const konum = ilce ? `${ilce.ad}, ${il.ad}` : il ? il.ad : '';
  res.render('listings', {
    title: konum ? `${konum} ikinci el ve takas ilanları` : 'İlanlar',
    description: konum ? `${konum} bölgesindeki komisyonsuz ikinci el ve takas ilanları, yerel işletmeler.` : null,
    ilanlar, toplam, sayfa, sayfaSayisi,
    filtre: { il: il ? il.slug : '', ilce: ilce ? ilce.slug : '', kategori, q: ara, sirala, tip },
    il, ilce, reklamlar,
  });
}

router.get('/ilanlar', (req, res) => renderListings(req, res));
router.get('/il/:il', (req, res, next) => (getIl(req.params.il) ? renderListings(req, res, { il: req.params.il }) : next()));
router.get('/il/:il/:ilce', (req, res, next) =>
  getIlce(req.params.il, req.params.ilce) ? renderListings(req, res, { il: req.params.il, ilce: req.params.ilce }) : next());

// ---- İlan detay ----
const getListing = db.prepare(`SELECT l.*, u.name AS seller_name, u.created_at AS seller_since,
  (SELECT COUNT(*) FROM listings x WHERE x.user_id = l.user_id AND x.status = 'active') AS seller_count
  FROM listings l JOIN users u ON u.id = l.user_id WHERE l.id = ?`);
const addView = db.prepare('UPDATE listings SET views = views + 1 WHERE id = ?');
const similar = db.prepare(`SELECT * FROM listings WHERE status = 'active' AND id != ? AND il = ? AND category = ?
  ORDER BY created_at DESC LIMIT 4`);

router.get('/ilan/:id', (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  const ilan = id ? getListing.get(id) : null;
  const isOwner = ilan && req.user && req.user.id === ilan.user_id;
  if (!ilan || (ilan.status === 'removed' && !isOwner && !(req.user && req.user.is_admin))) return next();

  const canonical = h.ilanUrl(ilan);
  if (req.path !== canonical) return res.redirect(301, canonical);

  req.session.seen = req.session.seen || [];
  if (!isOwner && !req.session.seen.includes(id)) {
    addView.run(id);
    ilan.views++;
    req.session.seen = req.session.seen.slice(-200).concat(id);
  }

  res.render('listing', {
    title: ilan.title,
    description: ilan.description.slice(0, 155),
    ilan, isOwner,
    kategori: getKategori(ilan.category),
    reklamlar: getSlots(ilan.il, ilan.ilce, { countImpression: true }),
    benzer: similar.all(ilan.id, ilan.il, ilan.category),
  });
});

// ---- İlan ver / düzenle ----
function readForm(req) {
  const tur = req.body.tur === 'takas' ? 'takas' : req.body.tur === 'ikisi' ? 'ikisi' : 'satilik';
  const fiyatRaw = String(req.body.price || '').replace(/[^\d]/g, '');
  return {
    title: h.str(req.body.title, 90),
    description: h.str(req.body.description, 3000),
    category: isKategori(req.body.category) ? req.body.category : '',
    il: h.str(req.body.il, 60),
    ilce: h.str(req.body.ilce, 60),
    tur,
    price: tur === 'takas' ? null : fiyatRaw ? parseInt(fiyatRaw, 10) : null,
  };
}

function validate(f) {
  if (f.title.length < 5) return 'Başlık en az 5 karakter olmalı.';
  if (f.description.length < 10) return 'Açıklama en az 10 karakter olmalı.';
  if (!f.category) return 'Bir kategori seçin.';
  if (!getIlce(f.il, f.ilce)) return 'İl ve ilçe seçin.';
  if (f.tur !== 'takas' && (f.price == null || f.price < 1 || f.price > 100000000)) return 'Geçerli bir fiyat girin veya "Sadece takas" seçin.';
  return null;
}

const removeFile = (name) => { if (name) fs.unlink(path.join(h.UPLOAD_DIR, path.basename(name)), () => {}); };

router.get('/ilan-ver', h.requireLogin, (req, res) => {
  res.render('listing-form', { title: 'Ücretsiz İlan Ver', form: { tur: 'satilik' }, edit: false });
});

const insertListing = db.prepare(`INSERT INTO listings (user_id, title, description, category, price, is_swap, il, ilce, image)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

router.post('/ilan-ver', h.requireLogin, h.uploadSingle('image'), h.verifyCsrf, (req, res) => {
  const form = readForm(req);
  const error = req.uploadError || validate(form);
  if (error) {
    removeFile(req.file && req.file.filename);
    return res.status(400).render('listing-form', { title: 'Ücretsiz İlan Ver', form, edit: false, error });
  }
  const info = insertListing.run(req.user.id, form.title, form.description, form.category, form.price,
    form.tur === 'satilik' ? 0 : 1, form.il, form.ilce, req.file ? req.file.filename : null);
  h.flash(req, 'success', 'İlanın yayında! 🥕');
  res.redirect(h.ilanUrl({ id: Number(info.lastInsertRowid), title: form.title }));
});

const ownListing = db.prepare('SELECT * FROM listings WHERE id = ? AND user_id = ?');

router.get('/ilan/:id/duzenle', h.requireLogin, (req, res, next) => {
  const l = ownListing.get(parseInt(req.params.id, 10) || 0, req.user.id);
  if (!l) return next();
  const form = { ...l, tur: l.price == null ? 'takas' : l.is_swap ? 'ikisi' : 'satilik' };
  res.render('listing-form', { title: 'İlanı Düzenle', form, edit: true });
});

const updateListing = db.prepare(`UPDATE listings SET title = ?, description = ?, category = ?, price = ?, is_swap = ?,
  il = ?, ilce = ?, image = ? WHERE id = ? AND user_id = ?`);

router.post('/ilan/:id/duzenle', h.requireLogin, h.uploadSingle('image'), h.verifyCsrf, (req, res, next) => {
  const l = ownListing.get(parseInt(req.params.id, 10) || 0, req.user.id);
  if (!l) { removeFile(req.file && req.file.filename); return next(); }
  const form = { ...readForm(req), id: l.id, image: l.image };
  const error = req.uploadError || validate(form);
  if (error) {
    removeFile(req.file && req.file.filename);
    return res.status(400).render('listing-form', { title: 'İlanı Düzenle', form, edit: true, error });
  }
  let image = l.image;
  if (req.file) { removeFile(l.image); image = req.file.filename; } else if (req.body.remove_image) { removeFile(l.image); image = null; }
  updateListing.run(form.title, form.description, form.category, form.price, form.tur === 'satilik' ? 0 : 1,
    form.il, form.ilce, image, l.id, req.user.id);
  h.flash(req, 'success', 'İlan güncellendi.');
  res.redirect(h.ilanUrl(form));
});

const setStatus = db.prepare('UPDATE listings SET status = ? WHERE id = ? AND user_id = ?');
router.post('/ilan/:id/durum', h.requireLogin, h.verifyCsrf, (req, res, next) => {
  const l = ownListing.get(parseInt(req.params.id, 10) || 0, req.user.id);
  if (!l) return next();
  const status = { sold: 'sold', active: 'active', removed: 'removed' }[req.body.status];
  if (status) setStatus.run(status, l.id, req.user.id);
  h.flash(req, 'success', { sold: 'İlan "takas edildi / satıldı" olarak işaretlendi.', active: 'İlan tekrar yayında.', removed: 'İlan kaldırıldı.' }[status] || 'Güncellendi.');
  res.redirect(status === 'removed' ? '/hesabim' : h.ilanUrl(l));
});

// ---- Şikayet ----
const insertReport = db.prepare('INSERT INTO reports (listing_id, user_id, reason) VALUES (?, ?, ?)');
router.post('/ilan/:id/sikayet', h.verifyCsrf, (req, res, next) => {
  const l = getListing.get(parseInt(req.params.id, 10) || 0);
  if (!l) return next();
  const reason = [h.str(req.body.reason, 60), h.str(req.body.detail, 500)].filter(Boolean).join(' — ');
  if (!reason) { h.flash(req, 'error', 'Lütfen şikayet nedenini seçin.'); return res.redirect(h.ilanUrl(l)); }
  insertReport.run(l.id, req.user ? req.user.id : null, reason);
  h.flash(req, 'success', 'Bildirimin için teşekkürler. Ekibimiz ilanı inceleyecek.');
  res.redirect(h.ilanUrl(l));
});

// ---- Hesabım ----
const myListings = db.prepare(`SELECT * FROM listings WHERE user_id = ? AND status != 'removed' ORDER BY created_at DESC`);
router.get('/hesabim', h.requireLogin, (req, res) => {
  res.render('account', { title: 'Hesabım', ilanlar: myListings.all(req.user.id) });
});

module.exports = router;
