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
const ban = require('../lib/ban');
const bildirim = require('../lib/bildirim');
const yonetim = require('../lib/yonetim');

const router = express.Router();
router.use(h.requireAdmin);
router.use((req, res, next) => { res.locals.noindex = true; next(); });
router.use(yonetim.kayitAraKatmani);

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

const REKLAM_DURUM = { bekleyen: ['pending'], aktif: ['active'], gecmis: ['rejected', 'ended'] };
const REKLAM_SIRA = { bekleyen: 'created_at', aktif: 'renew_months IS NULL, end_date', gecmis: 'id DESC' };
const TABS = ['ozet', 'bekleyen', 'aktif', 'gecmis', 'alanlar', 'onay', 'sikayet', 'iletisim', 'siparis', 'ilan', 'uye',
  'grafik', 'fiyatlar', 'kargo', 'kelimeler', 'yedek', 'kayit', 'sistem'];
const ILAN_DURUM = { active: 'Yayında', pending: 'Onay bekliyor', sold: 'Satıldı', expired: 'Süresi doldu', removed: 'Kaldırıldı', rejected: 'Reddedildi' };
const SAYFA = 50;

function backupList() {
  try {
    return fs.readdirSync(config.backup.dir).filter((f) => f.endsWith('.db')).sort().reverse()
      .map((f) => ({ f, size: fs.statSync(require('node:path').join(config.backup.dir, f)).size }));
  } catch { return []; }
}
const sayfaNo = (req) => Math.max(1, Math.min(10000, parseInt(req.query.sayfa, 10) || 1));
const like = (q) => '%' + db.arama(q) + '%';

router.get('/', (req, res) => {
  expireOld();
  const tab = TABS.includes(req.query.tab) ? req.query.tab : 'ozet';
  const q = h.str(req.query.q, 100);
  const sayfa = sayfaNo(req);
  let rows = [];
  const extra = { q, sayfa, sayfaSayisi: 1, toplam: 0, ILAN_DURUM };
  const sayfala = (sqlFrom, args) => {
    extra.toplam = db.prepare(`SELECT COUNT(*) AS n ${sqlFrom}`).get(...args).n;
    extra.sayfaSayisi = Math.max(1, Math.ceil(extra.toplam / SAYFA));
    return [SAYFA, (sayfa - 1) * SAYFA];
  };

  if (REKLAM_DURUM[tab]) {
    const d = REKLAM_DURUM[tab];
    rows = db.prepare(`SELECT * FROM ads WHERE status IN (${d.map(() => '?').join(',')})
      AND (? = '' OR ara_norm(business_name) LIKE ? OR lower(contact_email) LIKE ? OR ref_code LIKE ? OR il LIKE ? OR ilce LIKE ?)
      ORDER BY ${REKLAM_SIRA[tab]} LIMIT 300`).all(...d, q, like(q), '%' + q.toLowerCase() + '%', '%' + q.toUpperCase() + '%', like(q), like(q));
  }
  else if (tab === 'ozet') Object.assign(extra, yonetim.ozet());
  else if (tab === 'alanlar') extra.alan = yonetim.alanDoluluk();
  else if (tab === 'onay') rows = db.prepare(`SELECT l.*, u.name AS seller FROM listings l JOIN users u ON u.id = l.user_id
      WHERE l.status = 'pending' ORDER BY l.id`).all();
  else if (tab === 'sikayet') rows = db.prepare(`SELECT r.*, l.title, l.id AS lid, l.status AS lstatus, l.user_id AS owner_id, u.name AS owner_name,
      u.banned_at AS owner_banned FROM reports r JOIN listings l ON l.id = r.listing_id JOIN users u ON u.id = l.user_id
      WHERE r.status = 'open' ORDER BY r.id DESC`).all();
  else if (tab === 'iletisim') rows = db.prepare(`SELECT * FROM contact_messages ORDER BY status = 'open' DESC, id DESC LIMIT 200`).all();
  else if (tab === 'ilan') {
    const durum = ILAN_DURUM[req.query.durum] ? req.query.durum : '';
    const from = `FROM listings l JOIN users u ON u.id = l.user_id WHERE (? = '' OR l.status = ?)
      AND (? = '' OR ara_norm(l.title) LIKE ? OR ara_norm(u.name) LIKE ? OR l.id = ?)`;
    const args = [durum, durum, q, like(q), like(q), parseInt(q, 10) || 0];
    const [lim, off] = sayfala(from, args);
    rows = db.prepare(`SELECT l.*, u.name AS seller ${from} ORDER BY l.id DESC LIMIT ? OFFSET ?`).all(...args, lim, off);
    extra.durum = durum;
  }
  else if (tab === 'uye') {
    const filtre = ['engelli', 'dogrulanmamis', 'yonetici', 'google'].includes(req.query.filtre) ? req.query.filtre : '';
    const kosul = { engelli: 'u.banned_at IS NOT NULL', dogrulanmamis: 'u.email_verified = 0', yonetici: 'u.is_admin = 1', google: 'u.google_id IS NOT NULL' }[filtre] || '1';
    const from = `FROM users u WHERE ${kosul} AND (? = '' OR ara_norm(u.name) LIKE ? OR u.email LIKE ? OR u.id = ?)`;
    const args = [q, like(q), '%' + q.toLowerCase() + '%', parseInt(q, 10) || 0];
    const [lim, off] = sayfala(from, args);
    rows = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM listings WHERE user_id = u.id) AS ilan_sayisi,
      (SELECT COUNT(*) FROM reports r JOIN listings l ON l.id = r.listing_id WHERE l.user_id = u.id) AS sikayet_sayisi
      ${from} ORDER BY u.banned_at IS NOT NULL, u.id DESC LIMIT ? OFFSET ?`).all(...args, lim, off);
    Object.assign(extra, { uyeAra: q, filtre });
  }
  else if (tab === 'siparis') {
    const durum = orders.DURUMLAR[req.query.durum] ? req.query.durum : '';
    rows = db.prepare(`SELECT o.*, b.name AS buyer, s.name AS seller FROM orders o JOIN users b ON b.id = o.buyer_id JOIN users s ON s.id = o.seller_id
      WHERE o.status != 'odeme_bekliyor' AND NOT (o.status = 'iptal' AND o.paid_at IS NULL) AND (? = '' OR o.status = ?)
        AND (? = '' OR o.code LIKE ? OR ara_norm(o.title) LIKE ?)
      ORDER BY o.status = 'itiraz' DESC, o.status IN ('odendi','kargoda') DESC, o.id DESC LIMIT 300`).all(durum, durum, q, '%' + q.toUpperCase() + '%', like(q));
    Object.assign(extra, { DURUMLAR: orders.DURUMLAR, durum, ciro: db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS hacim
      FROM orders WHERE status = 'tamamlandi'`).get() });
  }
  else if (tab === 'kargo') Object.assign(extra, { saglayici: (require('../lib/payments').provider() || { name: 'kapalı' }).name });
  else if (tab === 'fiyatlar') Object.assign(extra, { gruplar: pricing.GRUPLAR, fiyatTablo: pricing.tablo(), ozel: pricing.overrides() });
  else if (tab === 'grafik') { const ist = require('../lib/istatistik'); Object.assign(extra, { grafikler: ist.hepsi(), grafikSvg: ist.svg, grafikGun: ist.GUN, sayi: ist.sayi }); }
  else if (tab === 'kelimeler') extra.kelimeler = moderation.wordsText();
  else if (tab === 'yedek') Object.assign(extra, { yedekler: backupList(), yedekDir: config.backup.dir, keep: config.backup.keepDays });
  else if (tab === 'kayit') { const k = yonetim.kayitlar({ q, sayfa }); rows = k.rows; Object.assign(extra, { toplam: k.toplam, sayfaSayisi: k.sayfaSayisi }); }
  else if (tab === 'sistem') extra.sistem = yonetim.sistem();
  if (tab === 'ozet') { const ist = require('../lib/istatistik'); Object.assign(extra, { grafikler: ist.hepsi(), grafikSvg: ist.svg, grafikGun: ist.GUN, sayi: ist.sayi }); }
  res.render('admin', { title: 'Yönetim Paneli', tab, rows, c: counts.get(), SLOT_SAYISI, ...extra });
});

// ---- Dışa aktarma (CSV, Excel'de açılır) ----
router.get('/disa-aktar/:tur', (req, res, next) => {
  const gun = new Date().toISOString().slice(0, 10);
  let ad, veri;
  if (req.params.tur === 'uyeler') {
    ad = 'uyeler';
    veri = yonetim.csv(['No', 'Ad', 'E-posta', 'Doğrulandı', 'Yönetici', 'Google', 'Engellendi', 'Kayıt'],
      db.prepare('SELECT id, name, email, email_verified, is_admin, google_id IS NOT NULL AS g, banned_at, created_at FROM users ORDER BY id').all()
        .map((u) => [u.id, u.name, u.email, u.email_verified ? 'evet' : 'hayır', u.is_admin ? 'evet' : '', u.g ? 'evet' : '', u.banned_at || '', u.created_at]));
  } else if (req.params.tur === 'ilanlar') {
    ad = 'ilanlar';
    veri = yonetim.csv(['No', 'Başlık', 'Fiyat', 'Takas', 'İl', 'İlçe', 'Durum', 'Görüntülenme', 'Satıcı no', 'Tarih'],
      db.prepare('SELECT id, title, price, is_swap, il, ilce, status, views, user_id, created_at FROM listings ORDER BY id').all()
        .map((l) => [l.id, l.title, l.price ?? '', l.is_swap ? 'evet' : '', l.il, l.ilce, ILAN_DURUM[l.status] || l.status, l.views, l.user_id, l.created_at]));
  } else if (req.params.tur === 'reklamlar') {
    ad = 'reklamlar';
    veri = yonetim.csv(['No', 'İşletme', 'İl', 'İlçe', 'Alan', 'Ay', 'Fiyat', 'Durum', 'Başlangıç', 'Bitiş', 'Gösterim', 'Tıklama', 'Referans', 'Yetkili', 'E-posta'],
      db.prepare('SELECT * FROM ads ORDER BY id').all()
        .map((a) => [a.id, a.business_name, a.il, a.ilce || '', a.slot, a.months, a.price ?? '', a.status, a.start_date || '', a.end_date || '',
          a.impressions, a.clicks, a.ref_code, a.contact_name, a.contact_email]));
  } else return next();
  yonetim.kaydet(req, 'Dışa aktarıldı', ad + '.csv');
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="havuc-${ad}-${gun}.csv"`, 'Cache-Control': 'no-store' });
  res.send(veri);
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
  h.flash(req, 'success', 'Mesaj kapatıldı.');
  res.redirect('/yonetim?tab=iletisim');
});

router.post('/sikayet/:id/kapat', h.verifyCsrf, (req, res) => {
  db.prepare("UPDATE reports SET status = 'closed' WHERE id = ?").run(parseInt(req.params.id, 10) || 0);
  h.flash(req, 'success', 'Şikayet kapatıldı.');
  res.redirect('/yonetim?tab=sikayet');
});

const listingById = db.prepare('SELECT * FROM listings WHERE id = ?');
function ilanDurum(l, status) {
  db.prepare('UPDATE listings SET status = ?, mod_reason = CASE WHEN ? = \'active\' THEN NULL ELSE mod_reason END WHERE id = ?').run(status, status, l.id);
  if (status !== 'active') db.prepare("UPDATE reports SET status = 'closed' WHERE listing_id = ?").run(l.id);
  if (l.status === 'pending') notify.listingDecision(l, status === 'active');
  if (l.status === 'pending' && status === 'active') {
    db.prepare("UPDATE listings SET expires_at = datetime('now', '+30 days'), expiry_reminded = 0 WHERE id = ?").run(l.id);
    bildirim.yeniIlan(listingById.get(l.id));
  }
}
const GERI = ['sikayet', 'onay', 'ilan'];
const geri = (req) => {
  const back = GERI.includes(req.body.back) ? req.body.back : 'ilan';
  const keep = h.safeNext(req.body.donus);
  return keep.startsWith('/yonetim?') ? keep : '/yonetim?tab=' + back;
};
const secilenler = (b) => [].concat(b.ids || []).map((x) => parseInt(x, 10)).filter((x) => x > 0).slice(0, 500);

router.post('/ilan/toplu', h.verifyCsrf, (req, res) => {
  const status = { active: 'active', removed: 'removed', rejected: 'rejected' }[req.body.status];
  const ids = secilenler(req.body);
  if (!status || !ids.length) { h.flash(req, 'error', 'Önce en az bir ilan seç.'); return res.redirect(geri(req)); }
  let n = 0;
  for (const id of ids) { const l = listingById.get(id); if (l && l.status !== status) { ilanDurum(l, status); n++; } }
  h.flash(req, 'success', `${n} ilan ${{ active: 'yayına alındı', removed: 'kaldırıldı', rejected: 'reddedildi' }[status]}.`);
  res.redirect(geri(req));
});

router.post('/ilan/:id/durum', h.verifyCsrf, (req, res, next) => {
  const l = listingById.get(parseInt(req.params.id, 10) || 0);
  if (!l) return next();
  const status = { active: 'active', removed: 'removed', rejected: 'rejected' }[req.body.status] || 'removed';
  ilanDurum(l, status);
  h.flash(req, 'success', status === 'active' ? 'İlan yayında.' : 'İlan yayından kaldırıldı.');
  res.redirect(geri(req));
});

router.post('/sikayet/toplu', h.verifyCsrf, (req, res) => {
  const ids = secilenler(req.body);
  if (!ids.length) { h.flash(req, 'error', 'Önce en az bir şikayet seç.'); return res.redirect('/yonetim?tab=sikayet'); }
  const r = db.prepare(`UPDATE reports SET status = 'closed' WHERE status = 'open' AND id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  h.flash(req, 'success', `${r.changes} şikayet kapatıldı.`);
  res.redirect('/yonetim?tab=sikayet');
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
