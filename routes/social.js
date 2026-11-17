// Favoriler, satıcı profili ve puanlama
const express = require('express');
const db = require('../lib/db');
const h = require('../lib/helpers');
const reviews = require('../lib/reviews');
const { rateLimit } = require('../lib/security');

const router = express.Router();

const listing = db.prepare('SELECT * FROM listings WHERE id = ?');
const addFav = db.prepare('INSERT OR IGNORE INTO favorites (user_id, listing_id) VALUES (?, ?)');
const delFav = db.prepare('DELETE FROM favorites WHERE user_id = ? AND listing_id = ?');

router.post('/ilan/:id/favori', h.requireLogin, h.verifyCsrf, (req, res, next) => {
  const l = listing.get(parseInt(req.params.id, 10) || 0);
  if (!l) return next();
  const ekle = req.body.islem !== 'cikar';
  if (ekle) addFav.run(req.user.id, l.id); else delFav.run(req.user.id, l.id);
  if (req.get('accept') === 'application/json') return res.json({ ok: true, fav: ekle });
  h.flash(req, 'success', ekle ? 'Favorilerine eklendi ❤️' : 'Favorilerinden çıkarıldı.');
  res.redirect(h.safeNext(req.body.next) === '/' ? h.ilanUrl(l) : h.safeNext(req.body.next));
});

const myFavs = db.prepare(`SELECT l.* FROM favorites f JOIN listings l ON l.id = f.listing_id
  WHERE f.user_id = ? AND l.status IN ('active', 'sold') ORDER BY f.created_at DESC`);
router.get('/favorilerim', h.requireLogin, (req, res) => {
  res.render('favorites', { title: 'Favorilerim', ilanlar: myFavs.all(req.user.id), noindex: true });
});

// ---- Satıcı profili ----
const user = db.prepare('SELECT id, name, created_at FROM users WHERE id = ?');
const userListings = db.prepare(`SELECT * FROM listings WHERE user_id = ? AND status IN ('active', 'sold')
  ORDER BY status = 'sold', created_at DESC LIMIT 60`);
const userReviews = db.prepare(`SELECT r.*, u.name AS reviewer, l.title FROM reviews r
  JOIN users u ON u.id = r.reviewer_id JOIN listings l ON l.id = r.listing_id
  WHERE r.seller_id = ? ORDER BY r.id DESC LIMIT 50`);
const soldCount = db.prepare("SELECT COUNT(*) AS n FROM listings WHERE user_id = ? AND status = 'sold'");

router.get('/uye/:id', (req, res, next) => {
  const u = user.get(parseInt(req.params.id, 10) || 0);
  if (!u) return next();
  const ozet = reviews.summary(u.id);
  res.render('profile', {
    title: `${u.name} - Satıcı Profili`,
    description: `${u.name} kullanıcısının Havuç Takas ilanları ve değerlendirmeleri.`,
    uye: u, ozet, ilanlar: userListings.all(u.id), yorumlar: userReviews.all(u.id), satilan: soldCount.get(u.id).n,
  });
});

// ---- Puanlama ----
const insReview = db.prepare('INSERT INTO reviews (listing_id, reviewer_id, seller_id, score, comment) VALUES (?, ?, ?, ?, ?)');
router.post('/ilan/:id/degerlendir', h.requireLogin, rateLimit('puan', 20, 60), h.verifyCsrf, (req, res, next) => {
  const l = listing.get(parseInt(req.params.id, 10) || 0);
  if (!l) return next();
  const back = `/mesajlar/${l.id}/${l.user_id}`;
  const score = parseInt(req.body.score, 10);
  if (!reviews.canReview(l, req.user.id)) { h.flash(req, 'error', 'Bu ilan için değerlendirme yapamazsın.'); return res.redirect(back); }
  if (reviews.existing(l.id, req.user.id)) { h.flash(req, 'error', 'Bu ilanı zaten değerlendirdin.'); return res.redirect(back); }
  if (!(score >= 1 && score <= 5)) { h.flash(req, 'error', '1 ile 5 arasında puan seç.'); return res.redirect(back); }
  insReview.run(l.id, req.user.id, l.user_id, score, h.str(req.body.comment, 500) || null);
  h.flash(req, 'success', 'Değerlendirmen için teşekkürler! ⭐');
  res.redirect(`/uye/${l.user_id}`);
});

module.exports = router;
