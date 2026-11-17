const fs = require('node:fs');
const express = require('express');
const db = require('../lib/db');
const h = require('../lib/helpers');
const config = require('../lib/config');
const pricing = require('../lib/pricing');
const moderation = require('../lib/moderation');
const notify = require('../lib/notify');
const backup = require('../lib/backup');
const { isSlotFree, expireOld, SLOT_SAYISI } = require('../lib/ads');
const orders = require('../lib/orders');
const vitrin = require('../lib/vitrin');
const ban = require('../lib/ban');
const bildirim = require('../lib/bildirim');

const router = express.Router();
router.use(h.requireAdmin);
router.use((req, res, next) => { res.locals.noindex = true; next(); });

const counts = db.prepare(`SELECT
  (SELECT COUNT(*) FROM ads WHERE status = 'pending') AS bekleyen,
  (SELECT COUNT(*) FROM ads WHERE status = 'active') AS aktif,
  (SELECT COUNT(*) FROM ads WHERE status = 'active' AND renew_months IS NOT NULL) AS uzatma,
  (SELECT COUNT(*) FROM listings WHERE status = 'pending') AS onay,
  (SELECT COUNT(*) FROM reports WHERE status = 'open') AS sikayet,
  (SELECT COUNT(*) FROM listings WHERE status = 'active') AS ilan,
  (SELECT COUNT(*) FROM users) AS uye,
  (SELECT COUNT(*) FROM contact_messages WHERE status = 'open') AS iletisim,
  (SELECT COUNT(*) FROM orders WHERE status = 'itiraz') AS itiraz,
  (SELECT COUNT(*) FROM orders WHERE status IN ('odendi','kargoda','itiraz')) AS acik_siparis`);

const SEKMELER = {
  bekleyen: "SELECT * FROM ads WHERE status = 'pending' ORDER BY created_at",
  aktif: "SELECT * FROM ads WHERE status = 'active' ORDER BY renew_months IS NULL, end_date",
  gecmis: "SELECT * FROM ads WHERE status IN ('rejected','ended') ORDER BY id DESC LIMIT 200",
};
const TABS = ['grafik', 'bekleyen', 'aktif', 'gecmis', 'onay', 'sikayet', 'iletisim', 'siparis', 'ilan', 'uye', 'fiyatlar', 'kargo', 'kelimeler', 'yedek'];

function backupList() {
  try {
    return fs.readdirSync(config.backup.dir).filter((f) => f.endsWith('.db')).sort().reverse()
      .map((f) => ({ f, size: fs.statSync(require('node:path').join(config.backup.dir, f)).size }));
  } catch { return []; }
}

router.get('/', (req, res) => {
  expireOld();
  const tab = TABS.includes(req.query.tab) ? req.query.tab : 'bekleyen';
  let rows = [];
  const extra = {};
  if (SEKMELER[tab]) rows = db.prepare(SEKMELER[tab]).all();
  else if (tab === 'onay') rows = db.prepare(`SELECT l.*, u.name AS seller FROM listings l JOIN users u ON u.id = l.user_id
      WHERE l.status = 'pending' ORDER BY l.id`).all();
  else if (tab === 'sikayet') rows = db.prepare(`SELECT r.*, l.title, l.id AS lid, l.status AS lstatus, l.user_id AS owner_id, u.name AS owner_name,
      u.banned_at AS owner_banned FROM reports r JOIN listings l ON l.id = r.listing_id JOIN users u ON u.id = l.user_id
      WHERE r.status = 'open' ORDER BY r.id DESC`).all();
  else if (tab === 'iletisim') rows = db.prepare(`SELECT * FROM contact_messages ORDER BY status = 'open' DESC, id DESC LIMIT 200`).all();
  else if (tab === 'ilan') rows = db.prepare(`SELECT l.*, u.name AS seller FROM listings l JOIN users u ON u.id = l.user_id
      ORDER BY l.id DESC LIMIT 200`).all();
  else if (tab === 'uye') {
    const ara = h.str(req.query.q, 100);
    const like = '%' + db.arama(ara) + '%';
    rows = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM listings WHERE user_id = u.id) AS ilan_sayisi,
      (SELECT COUNT(*) FROM reports r JOIN listings l ON l.id = r.listing_id WHERE l.user_id = u.id) AS sikayet_sayisi
      FROM users u WHERE (? = '' OR ara_norm(u.name) LIKE ? OR u.email LIKE ? OR u.id = ?)
      ORDER BY u.banned_at IS NOT NULL, u.id DESC LIMIT 200`).all(ara, like, '%' + ara.toLowerCase() + '%', parseInt(ara, 10) || 0);
    extra.uyeAra = ara;
  }
  else if (tab === 'siparis') {
    rows = db.prepare(`SELECT o.*, b.name AS buyer, s.name AS seller FROM orders o JOIN users b ON b.id = o.buyer_id JOIN users s ON s.id = o.seller_id
      WHERE o.status != 'odeme_bekliyor' AND NOT (o.status = 'iptal' AND o.paid_at IS NULL)
      ORDER BY o.status = 'itiraz' DESC, o.status IN ('odendi','kargoda') DESC, o.id DESC LIMIT 300`).all();
    Object.assign(extra, { DURUMLAR: orders.DURUMLAR, ciro: db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(service_fee),0) AS hizmet, COALESCE(SUM(total),0) AS hacim
      FROM orders WHERE status = 'tamamlandi'`).get() });
  }
  else if (tab === 'kargo') Object.assign(extra, { kargoAyar: orders.ayarlar(), PAKETLER: orders.PAKETLER, saglayici: (require('../lib/payments').provider() || { name: 'kapalı' }).name,
    vitrinAyar: vitrin.ayarlar(),
    vitrinCiro: db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(price),0) AS toplam FROM featured_orders WHERE status = 'odendi'").get(),
    vitrinAktif: db.prepare("SELECT COUNT(*) AS n FROM listings WHERE status = 'active' AND featured_until > datetime('now')").get().n });
  else if (tab === 'fiyatlar') Object.assign(extra, { gruplar: pricing.GRUPLAR, fiyatTablo: pricing.tablo(), ozel: pricing.overrides() });
  else if (tab === 'grafik') { const ist = require('../lib/istatistik'); Object.assign(extra, { grafikler: ist.hepsi(), grafikSvg: ist.svg, grafikGun: ist.GUN, sayi: ist.sayi }); }
  else if (tab === 'kelimeler') extra.kelimeler = moderation.wordsText();
  else if (tab === 'yedek') Object.assign(extra, { yedekler: backupList(), yedekDir: config.backup.dir, keep: config.backup.keepDays });
  res.render('admin', { title: 'Yönetim Paneli', tab, rows, c: counts.get(), SLOT_SAYISI, ...extra });
});

const getAd = db.prepare('SELECT * FROM ads WHERE id = ?');
const approve = db.prepare(`UPDATE ads SET status = 'active', paid = 1, slot = ?, months = ?, start_date = date('now','localtime'),
  end_date = date('now','localtime', '+' || ? || ' months'), admin_note = COALESCE(?, admin_note) WHERE id = ?`);
const setStatus = db.prepare('UPDATE ads SET status = ?, admin_note = COALESCE(?, admin_note) WHERE id = ?');
const extend = db.prepare(`UPDATE ads SET end_date = date(end_date, '+' || ? || ' months'), renew_months = NULL, renew_price = NULL,
  reminded = 0 WHERE id = ? AND status = 'active'`);

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
      approve.run(slot, months, months, note, ad.id);
      notify.adApproved(getAd.get(ad.id));
      h.flash(req, 'success', `"${ad.business_name}" reklamı ${slot}. alanda yayında. İşletmeye e-posta gönderildi.`);
      break;
    }
    case 'reddet':
      setStatus.run('rejected', note, ad.id);
      notify.adRejected(ad, note);
      h.flash(req, 'success', 'Başvuru reddedildi, işletmeye bilgi verildi.');
      break;
    case 'durdur': setStatus.run('ended', note, ad.id); h.flash(req, 'success', 'Reklam yayından kaldırıldı.'); break;
    case 'uzat': {
      const months = Math.min(24, Math.max(1, parseInt(req.body.months, 10) || ad.renew_months || 1));
      extend.run(months, ad.id);
      if (ad.renew_months) notify.renewApproved(getAd.get(ad.id));
      h.flash(req, 'success', `Reklam süresi ${months} ay uzatıldı.`);
      break;
    }
    case 'uzatma-iptal':
      db.prepare('UPDATE ads SET renew_months = NULL, renew_price = NULL WHERE id = ?').run(ad.id);
      h.flash(req, 'success', 'Uzatma talebi silindi.');
      break;
    default: return next();
  }
  res.redirect(back);
});

// ---- Üye engelleme ----
router.post('/uye/:id/engelle', h.verifyCsrf, (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const back = h.safeNext(req.body.next) !== '/' ? h.safeNext(req.body.next) : '/yonetim?tab=uye';
  if (id === req.user.id) { h.flash(req, 'error', 'Kendini engelleyemezsin.'); return res.redirect(back); }
  const r = ban.engelle(id, h.str(req.body.reason, 300));
  if (!r) h.flash(req, 'error', 'Bu üye engellenemez (yönetici ya da zaten engelli).');
  else {
    db.prepare("UPDATE reports SET status = 'closed' WHERE listing_id IN (SELECT id FROM listings WHERE user_id = ?)").run(id);
    h.flash(req, 'success', `Üye kalıcı olarak engellendi. ${r.ilan} ilan ve ${r.reklam} reklam yayından kaldırıldı.`);
  }
  res.redirect(back);
});
router.post('/uye/:id/engel-kaldir', h.verifyCsrf, (req, res) => {
  ban.kaldir(parseInt(req.params.id, 10) || 0);
  h.flash(req, 'success', 'Engel kaldırıldı. Üyenin ilanları "süresi doldu" durumuna alındı; üye kontrol edip yenileyebilir.');
  res.redirect('/yonetim?tab=uye');
});

// ---- İletişim mesajları ----
router.post('/iletisim/:id/kapat', h.verifyCsrf, (req, res) => {
  db.prepare("UPDATE contact_messages SET status = 'closed' WHERE id = ?").run(parseInt(req.params.id, 10) || 0);
  res.redirect('/yonetim?tab=iletisim');
});

router.post('/sikayet/:id/kapat', h.verifyCsrf, (req, res) => {
  db.prepare("UPDATE reports SET status = 'closed' WHERE id = ?").run(parseInt(req.params.id, 10) || 0);
  res.redirect('/yonetim?tab=sikayet');
});

const listingById = db.prepare('SELECT * FROM listings WHERE id = ?');
router.post('/ilan/:id/durum', h.verifyCsrf, (req, res, next) => {
  const l = listingById.get(parseInt(req.params.id, 10) || 0);
  if (!l) return next();
  const status = { active: 'active', removed: 'removed', rejected: 'rejected' }[req.body.status] || 'removed';
  db.prepare('UPDATE listings SET status = ?, mod_reason = CASE WHEN ? = \'active\' THEN NULL ELSE mod_reason END WHERE id = ?').run(status, status, l.id);
  if (status !== 'active') db.prepare("UPDATE reports SET status = 'closed' WHERE listing_id = ?").run(l.id);
  if (l.status === 'pending') notify.listingDecision(l, status === 'active');
  if (l.status === 'pending' && status === 'active') {
    db.prepare("UPDATE listings SET expires_at = datetime('now', '+30 days'), expiry_reminded = 0 WHERE id = ?").run(l.id);
    bildirim.yeniIlan(listingById.get(l.id));
  }
  h.flash(req, 'success', status === 'active' ? 'İlan yayında.' : 'İlan yayından kaldırıldı.');
  const back = ['sikayet', 'onay'].includes(req.body.back) ? req.body.back : 'ilan';
  res.redirect('/yonetim?tab=' + back);
});

router.post('/kargo', h.verifyCsrf, (req, res) => {
  orders.setAyarlar(req.body);
  vitrin.setAyarlar(req.body);
  h.flash(req, 'success', 'Kargo, hizmet bedeli ve vitrin ayarları kaydedildi.');
  res.redirect('/yonetim?tab=kargo');
});

router.post('/siparis/:id/:islem', h.verifyCsrf, async (req, res, next) => {
  const o = orders.byId(parseInt(req.params.id, 10) || 0);
  if (!o || !['odendi', 'kargoda', 'itiraz'].includes(o.status)) return next();
  const note = h.str(req.body.note, 300) || null;
  try {
    if (req.params.islem === 'aktar') { await orders.tamamla(o, 'Yönetici satıcıya aktardı' + (note ? ': ' + note : '')); h.flash(req, 'success', `${o.code}: ödeme satıcıya aktarıldı.`); }
    else if (req.params.islem === 'iade') { await orders.iadeEt(o, 'Yönetici iade etti' + (note ? ': ' + note : '')); h.flash(req, 'success', `${o.code}: alıcıya iade edildi.`); }
    else return next();
  } catch (e) {
    h.flash(req, 'error', `İşlem yapılamadı: ${e.message}`);
  }
  res.redirect('/yonetim?tab=siparis');
});

router.post('/fiyatlar', h.verifyCsrf, (req, res) => {
  pricing.setTablo(req.body);
  h.flash(req, 'success', 'Fiyatlar kaydedildi.');
  res.redirect('/yonetim?tab=fiyatlar');
});

router.post('/fiyatlar/ozel', h.verifyCsrf, (req, res) => {
  const ok = pricing.setOverride(h.str(req.body.il, 60), h.str(req.body.ilce, 60), req.body.price || '');
  h.flash(req, ok ? 'success' : 'error', ok ? 'Özel fiyat kaydedildi (boş bırakılırsa silinir).' : 'Geçersiz il/ilçe.');
  res.redirect('/yonetim?tab=fiyatlar');
});

router.post('/kelimeler', h.verifyCsrf, (req, res) => {
  moderation.setWords(String(req.body.kelimeler || '').slice(0, 20000));
  h.flash(req, 'success', 'Yasaklı kelime listesi güncellendi.');
  res.redirect('/yonetim?tab=kelimeler');
});

router.post('/yedek', h.verifyCsrf, (req, res) => {
  try {
    const f = backup.run({ force: true });
    h.flash(req, 'success', `Yedek alındı: ${f}`);
  } catch (e) {
    h.flash(req, 'error', 'Yedek alınamadı: ' + e.message);
  }
  res.redirect('/yonetim?tab=yedek');
});

module.exports = router;
