const express = require('express');
const db = require('../lib/db');
const h = require('../lib/helpers');
const { isSlotFree, expireOld, SLOT_SAYISI } = require('../lib/ads');

const router = express.Router();
router.use(h.requireAdmin);

const counts = db.prepare(`SELECT
  (SELECT COUNT(*) FROM ads WHERE status = 'pending') AS bekleyen,
  (SELECT COUNT(*) FROM ads WHERE status = 'active') AS aktif,
  (SELECT COUNT(*) FROM reports WHERE status = 'open') AS sikayet,
  (SELECT COUNT(*) FROM listings WHERE status = 'active') AS ilan,
  (SELECT COUNT(*) FROM users) AS uye`);

const SEKMELER = {
  bekleyen: "SELECT * FROM ads WHERE status = 'pending' ORDER BY created_at",
  aktif: "SELECT * FROM ads WHERE status = 'active' ORDER BY end_date",
  gecmis: "SELECT * FROM ads WHERE status IN ('rejected','ended') ORDER BY id DESC LIMIT 200",
};

router.get('/', (req, res) => {
  expireOld();
  const tab = ['bekleyen', 'aktif', 'gecmis', 'sikayet', 'ilan', 'uye'].includes(req.query.tab) ? req.query.tab : 'bekleyen';
  let rows = [];
  if (SEKMELER[tab]) rows = db.prepare(SEKMELER[tab]).all();
  else if (tab === 'sikayet') rows = db.prepare(`SELECT r.*, l.title, l.id AS lid, l.status AS lstatus FROM reports r
      JOIN listings l ON l.id = r.listing_id WHERE r.status = 'open' ORDER BY r.id DESC`).all();
  else if (tab === 'ilan') rows = db.prepare(`SELECT l.*, u.name AS seller FROM listings l JOIN users u ON u.id = l.user_id
      ORDER BY l.id DESC LIMIT 200`).all();
  else if (tab === 'uye') rows = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM listings WHERE user_id = u.id) AS ilan_sayisi
      FROM users u ORDER BY u.id DESC LIMIT 200`).all();
  res.render('admin', { title: 'Yönetim Paneli', tab, rows, c: counts.get(), SLOT_SAYISI });
});

const getAd = db.prepare('SELECT * FROM ads WHERE id = ?');
const approve = db.prepare(`UPDATE ads SET status = 'active', slot = ?, start_date = date('now','localtime'),
  end_date = date('now','localtime', '+' || ? || ' months'), admin_note = ? WHERE id = ?`);
const setStatus = db.prepare('UPDATE ads SET status = ?, admin_note = COALESCE(?, admin_note) WHERE id = ?');
const extend = db.prepare(`UPDATE ads SET end_date = date(end_date, '+' || ? || ' months') WHERE id = ? AND status = 'active'`);

router.post('/reklam/:id/:islem', h.verifyCsrf, (req, res, next) => {
  const ad = getAd.get(parseInt(req.params.id, 10) || 0);
  if (!ad) return next();
  const note = h.str(req.body.note, 300) || null;
  const back = '/yonetim?tab=' + (ad.status === 'active' ? 'aktif' : 'bekleyen');

  switch (req.params.islem) {
    case 'onayla': {
      const slot = parseInt(req.body.slot, 10) || ad.slot;
      const months = Math.min(24, Math.max(1, parseInt(req.body.months, 10) || ad.months));
      if (slot < 1 || slot > SLOT_SAYISI) { h.flash(req, 'error', 'Geçersiz alan numarası.'); break; }
      if (!isSlotFree(ad.il, ad.ilce, slot, ad.id)) {
        h.flash(req, 'error', `${h.konumAdi(ad.il, ad.ilce)} için ${slot}. alan dolu. Başka bir alan numarası seçin.`);
        break;
      }
      approve.run(slot, months, note, ad.id);
      h.flash(req, 'success', `"${ad.business_name}" reklamı ${slot}. alanda yayında.`);
      break;
    }
    case 'reddet': setStatus.run('rejected', note, ad.id); h.flash(req, 'success', 'Başvuru reddedildi.'); break;
    case 'durdur': setStatus.run('ended', note, ad.id); h.flash(req, 'success', 'Reklam yayından kaldırıldı.'); break;
    case 'uzat': extend.run(Math.min(24, Math.max(1, parseInt(req.body.months, 10) || 1)), ad.id); h.flash(req, 'success', 'Reklam süresi uzatıldı.'); break;
    default: return next();
  }
  res.redirect(back);
});

router.post('/sikayet/:id/kapat', h.verifyCsrf, (req, res) => {
  db.prepare("UPDATE reports SET status = 'closed' WHERE id = ?").run(parseInt(req.params.id, 10) || 0);
  res.redirect('/yonetim?tab=sikayet');
});

router.post('/ilan/:id/durum', h.verifyCsrf, (req, res) => {
  const status = req.body.status === 'active' ? 'active' : 'removed';
  const id = parseInt(req.params.id, 10) || 0;
  db.prepare('UPDATE listings SET status = ? WHERE id = ?').run(status, id);
  if (status === 'removed') db.prepare("UPDATE reports SET status = 'closed' WHERE listing_id = ?").run(id);
  h.flash(req, 'success', status === 'removed' ? 'İlan kaldırıldı.' : 'İlan tekrar yayında.');
  res.redirect('/yonetim?tab=' + (req.body.back === 'sikayet' ? 'sikayet' : 'ilan'));
});

module.exports = router;
