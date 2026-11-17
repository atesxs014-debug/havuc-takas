const express = require('express');
const db = require('../lib/db');
const h = require('../lib/helpers');
const images = require('../lib/images');
const moderation = require('../lib/moderation');
const notify = require('../lib/notify');
const { rateLimit, turnstile } = require('../lib/security');
const { getIl, getIlce } = require('../lib/locations');
const { isKategori, getKategori } = require('../lib/categories');
const { getSlots } = require('../lib/ads');

const router = express.Router();
const SAYFA_BOYUTU = 24;

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
  const base = res.locals.base;
  res.render('listings', {
    title: konum ? `${konum} ikinci el ve takas ilanları` : 'İlanlar',
    description: konum ? `${konum} bölgesindeki komisyonsuz ikinci el ve takas ilanları, yerel işletmeler.` : 'Türkiye genelinde komisyonsuz ikinci el ve takas ilanları.',
    // Filtreli/aramalı sayfaları dizine ekletme; temiz il/ilçe sayfası kanonik olsun
    canonical: base + (ilce ? `/il/${il.slug}/${ilce.slug}` : il ? `/il/${il.slug}` : '/ilanlar') + (sayfa > 1 ? `?sayfa=${sayfa}` : ''),
    noindex: !!(ara || kategori || tip || sirala !== 'yeni'),
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
  (SELECT COUNT(*) FROM listings x WHERE x.user_id = l.user_id AND x.status = 'active') AS seller_count,
  (SELECT ROUND(AVG(score), 1) FROM reviews r WHERE r.seller_id = l.user_id) AS seller_rating,
  (SELECT COUNT(*) FROM reviews r WHERE r.seller_id = l.user_id) AS seller_reviews
  FROM listings l JOIN users u ON u.id = l.user_id WHERE l.id = ?`);
const getImages = db.prepare('SELECT * FROM listing_images WHERE listing_id = ? ORDER BY sort, id');
const addView = db.prepare('UPDATE listings SET views = views + 1 WHERE id = ?');
const favCount = db.prepare('SELECT COUNT(*) AS n FROM favorites WHERE listing_id = ?');
const similar = db.prepare(`SELECT * FROM listings WHERE status = 'active' AND id != ? AND il = ? AND category = ?
  ORDER BY created_at DESC LIMIT 4`);

router.get('/ilan/:id', (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  const ilan = id ? getListing.get(id) : null;
  if (!ilan) return next();
  const isOwner = !!(req.user && req.user.id === ilan.user_id);
  const isAdmin = !!(req.user && req.user.is_admin);
  if (['removed', 'pending', 'rejected'].includes(ilan.status) && !isOwner && !isAdmin) return next();

  const canonical = h.ilanUrl(ilan);
  if (req.path !== canonical) return res.redirect(301, canonical);

  req.session.seen = req.session.seen || [];
  if (!isOwner && ilan.status === 'active' && !req.session.seen.includes(id)) {
    addView.run(id);
    ilan.views++;
    req.session.seen = req.session.seen.slice(-200).concat(id);
  }

  const fotolar = getImages.all(id);
  const base = res.locals.base;
  const k = getKategori(ilan.category);
  // Google için yapısal veri (Product + Offer)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: ilan.title,
    description: ilan.description.slice(0, 500),
    category: k.ad,
    image: fotolar.length ? fotolar.map((f) => `${base}/uploads/${f.file}`) : [`${base}/static/img/og.png`],
    itemCondition: 'https://schema.org/UsedCondition',
  };
  if (ilan.price != null) {
    jsonLd.offers = {
      '@type': 'Offer', price: ilan.price, priceCurrency: 'TRY',
      availability: ilan.status === 'active' ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
      areaServed: h.konumAdi(ilan.il, ilan.ilce),
      seller: { '@type': 'Person', name: ilan.seller_name },
    };
  }

  res.render('listing', {
    title: `${ilan.title} - ${h.konumAdi(ilan.il, ilan.ilce)}`,
    description: (ilan.price != null ? h.fiyat(ilan.price) + ' · ' : 'Takaslık · ') + ilan.description.slice(0, 140),
    canonical: base + canonical,
    ogImage: fotolar.length ? `${base}/uploads/${fotolar[0].file}` : res.locals.ogImage,
    ogType: 'product',
    noindex: ilan.status !== 'active',
    jsonLd,
    ilan, isOwner, fotolar, kategori: k,
    favSayisi: favCount.get(id).n,
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

async function savePhotos(listingId, files, startSort) {
  let sort = startSort;
  for (const f of files) {
    const saved = await images.saveListingPhoto(f.buffer);
    insImage.run(listingId, saved.file, saved.thumb, sort++);
  }
}

const insImage = db.prepare('INSERT INTO listing_images (listing_id, file, thumb, sort) VALUES (?, ?, ?, ?)');
const setCover = db.prepare(`UPDATE listings SET image = (SELECT thumb FROM listing_images WHERE listing_id = ? ORDER BY sort, id LIMIT 1) WHERE id = ?`);

router.get('/ilan-ver', h.requireLogin, h.requireVerified, (req, res) => {
  res.render('listing-form', { title: 'Ücretsiz İlan Ver', form: { tur: 'satilik' }, edit: false, fotolar: [], MAX_FOTO: images.MAX_FOTO, noindex: true });
});

const insertListing = db.prepare(`INSERT INTO listings (user_id, title, description, category, price, is_swap, il, ilce, status, mod_reason)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

router.post('/ilan-ver', h.requireLogin, h.requireVerified, rateLimit('ilan', 20, 60 * 24), images.parse('photos', images.MAX_FOTO),
  h.verifyCsrf, turnstile, async (req, res, next) => {
    try {
      const form = readForm(req);
      const error = req.uploadError || req.botError || validate(form);
      if (error) {
        return res.status(400).render('listing-form', { title: 'Ücretsiz İlan Ver', form, edit: false, fotolar: [], MAX_FOTO: images.MAX_FOTO, error });
      }
      const hits = moderation.check(form.title, form.description);
      const status = hits.length ? 'pending' : 'active';
      const info = insertListing.run(req.user.id, form.title, form.description, form.category, form.price,
        form.tur === 'satilik' ? 0 : 1, form.il, form.ilce, status, hits.join(', ') || null);
      const id = Number(info.lastInsertRowid);
      try {
        await savePhotos(id, req.files, 0);
      } catch (e) {
        console.error('Fotoğraf işlenemedi:', e.message);
        h.flash(req, 'error', 'Bazı fotoğraflar okunamadı. İlanı düzenleyerek tekrar ekleyebilirsin.');
      }
      setCover.run(id, id);
      if (hits.length) {
        notify.listingPending({ id, title: form.title, mod_reason: hits.join(', ') }, req.user.id);
        if (!req.session.flash) h.flash(req, 'info', 'İlanın kısa bir incelemeden sonra yayına girecek. Onaylanınca e-posta ile haber vereceğiz.');
      } else if (!req.session.flash) {
        h.flash(req, 'success', 'İlanın yayında! 🥕');
      }
      res.redirect(h.ilanUrl({ id, title: form.title }));
    } catch (e) { next(e); }
  });

const ownListing = db.prepare('SELECT * FROM listings WHERE id = ? AND user_id = ?');

router.get('/ilan/:id/duzenle', h.requireLogin, (req, res, next) => {
  const l = ownListing.get(parseInt(req.params.id, 10) || 0, req.user.id);
  if (!l || l.status === 'removed') return next();
  const form = { ...l, tur: l.price == null ? 'takas' : l.is_swap ? 'ikisi' : 'satilik' };
  res.render('listing-form', { title: 'İlanı Düzenle', form, edit: true, fotolar: getImages.all(l.id), MAX_FOTO: images.MAX_FOTO, noindex: true });
});

const updateListing = db.prepare(`UPDATE listings SET title = ?, description = ?, category = ?, price = ?, is_swap = ?,
  il = ?, ilce = ?, status = ?, mod_reason = ? WHERE id = ? AND user_id = ?`);
const delImage = db.prepare('DELETE FROM listing_images WHERE id = ? AND listing_id = ?');
const imgById = db.prepare('SELECT * FROM listing_images WHERE id = ? AND listing_id = ?');

router.post('/ilan/:id/duzenle', h.requireLogin, images.parse('photos', images.MAX_FOTO), h.verifyCsrf, async (req, res, next) => {
  try {
    const l = ownListing.get(parseInt(req.params.id, 10) || 0, req.user.id);
    if (!l || l.status === 'removed') return next();
    const form = { ...readForm(req), id: l.id };
    const mevcut = getImages.all(l.id);
    const silinecek = [].concat(req.body.remove_img || []).map(Number);
    const kalan = mevcut.filter((f) => !silinecek.includes(f.id));
    let error = req.uploadError || validate(form);
    if (!error && kalan.length + req.files.length > images.MAX_FOTO) error = `En fazla ${images.MAX_FOTO} fotoğraf olabilir. Önce bazılarını kaldırın.`;
    if (error) {
      return res.status(400).render('listing-form', { title: 'İlanı Düzenle', form, edit: true, fotolar: mevcut, MAX_FOTO: images.MAX_FOTO, error });
    }
    for (const id of silinecek) {
      const img = imgById.get(id, l.id);
      if (img) { images.remove(img.file, img.thumb); delImage.run(id, l.id); }
    }
    // Kapak fotoğrafı seçimi
    const kapak = parseInt(req.body.cover_img, 10);
    if (kapak && kalan.some((f) => f.id === kapak)) {
      db.prepare('UPDATE listing_images SET sort = CASE WHEN id = ? THEN 0 ELSE sort + 1 END WHERE listing_id = ?').run(kapak, l.id);
    }
    await savePhotos(l.id, req.files, kalan.length + 1);

    const hits = moderation.check(form.title, form.description);
    let status = l.status;
    if (hits.length && ['active', 'pending'].includes(l.status)) status = 'pending';
    else if (!hits.length && l.status === 'pending') status = 'active';
    updateListing.run(form.title, form.description, form.category, form.price, form.tur === 'satilik' ? 0 : 1,
      form.il, form.ilce, status, hits.join(', ') || null, l.id, req.user.id);
    setCover.run(l.id, l.id);
    if (status === 'pending' && l.status !== 'pending') notify.listingPending({ id: l.id, title: form.title, mod_reason: hits.join(', ') }, req.user.id);
    h.flash(req, status === 'pending' ? 'info' : 'success', status === 'pending' ? 'İlan güncellendi ve incelemeye alındı.' : 'İlan güncellendi.');
    res.redirect(h.ilanUrl(form));
  } catch (e) { next(e); }
});

const setStatus = db.prepare('UPDATE listings SET status = ? WHERE id = ? AND user_id = ?');
router.post('/ilan/:id/durum', h.requireLogin, h.verifyCsrf, (req, res, next) => {
  const l = ownListing.get(parseInt(req.params.id, 10) || 0, req.user.id);
  if (!l || ['pending', 'rejected'].includes(l.status)) return next();
  const status = { sold: 'sold', active: 'active', removed: 'removed' }[req.body.status];
  if (status) setStatus.run(status, l.id, req.user.id);
  h.flash(req, 'success', { sold: 'İlan "takas edildi / satıldı" olarak işaretlendi. Alıcın seni artık puanlayabilir.', active: 'İlan tekrar yayında.', removed: 'İlan kaldırıldı.' }[status] || 'Güncellendi.');
  res.redirect(status === 'removed' ? '/hesabim' : h.ilanUrl(l));
});

// ---- Şikayet ----
const insertReport = db.prepare('INSERT INTO reports (listing_id, user_id, reason) VALUES (?, ?, ?)');
router.post('/ilan/:id/sikayet', rateLimit('sikayet', 10, 60), h.verifyCsrf, (req, res, next) => {
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
  res.render('account', { title: 'Hesabım', ilanlar: myListings.all(req.user.id), noindex: true });
});

module.exports = router;
