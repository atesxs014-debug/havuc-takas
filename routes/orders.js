// Güvenli ödemeli kargo: satıcı ödeme bilgileri, satın alma, sipariş takibi
const express = require('express');
const db = require('../lib/db');
const h = require('../lib/helpers');
const box = require('../lib/secret-box');
const orders = require('../lib/orders');
const { provider } = require('../lib/payments');
const { rateLimit } = require('../lib/security');
const { getIl, getIlce } = require('../lib/locations');

const router = express.Router();

const phoneE164 = (p) => {
  const d = String(p).replace(/\D/g, '').replace(/^90/, '').replace(/^0/, '');
  return /^5\d{9}$/.test(d) ? '+90' + d : null;
};

// ---- Satıcı ödeme bilgileri ----
const getAcc = db.prepare('SELECT * FROM payout_accounts WHERE user_id = ?');
const putAcc = db.prepare(`INSERT INTO payout_accounts (user_id, first_name, last_name, phone, address, iban_enc, iban_last4, tckn_enc, sub_merchant_key, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name,
  phone = excluded.phone, address = excluded.address, iban_enc = excluded.iban_enc, iban_last4 = excluded.iban_last4, tckn_enc = excluded.tckn_enc,
  sub_merchant_key = excluded.sub_merchant_key, updated_at = excluded.updated_at`);

router.get('/hesabim/odeme-bilgileri', h.requireLogin, (req, res) => {
  const acc = getAcc.get(req.user.id);
  res.render('orders/payout', { title: 'Ödeme Bilgilerim', acc, form: acc ? { ...acc } : { phone: req.user.phone || '' }, next: h.safeNext(req.query.next), noindex: true });
});

router.post('/hesabim/odeme-bilgileri', h.requireLogin, h.requireVerified, rateLimit('odeme-bilgi', 10, 60), h.verifyCsrf, async (req, res, next) => {
  try {
    const old = getAcc.get(req.user.id);
    const form = {
      first_name: h.str(req.body.first_name, 50), last_name: h.str(req.body.last_name, 50),
      phone: h.str(req.body.phone, 20), address: h.str(req.body.address, 250),
      iban: box.normIban(h.str(req.body.iban, 40)), tckn: h.str(req.body.tckn, 11),
    };
    // Kayıtlı bilgi varsa boş bırakılan IBAN/TCKN eskisi kalır
    if (old && !form.iban) form.iban = box.open(old.iban_enc);
    if (old && !form.tckn) form.tckn = box.open(old.tckn_enc);
    const nextUrl = h.safeNext(req.body.next);
    let error = null;
    if (form.first_name.length < 2 || form.last_name.length < 2) error = 'Adını ve soyadını kimliğindeki gibi yaz.';
    else if (!phoneE164(form.phone)) error = 'Geçerli bir cep telefonu gir (5xx xxx xx xx).';
    else if (form.address.length < 15) error = 'Açık adresini yaz.';
    else if (!box.ibanOk(form.iban)) error = 'IBAN geçersiz. TR ile başlayan 26 karakterlik IBAN\'ını kontrol et.';
    else if (!box.tcknOk(form.tckn)) error = 'TC kimlik numarası geçersiz.';
    else if (!req.body.onay) error = 'Ödeme aracılığı koşullarını onaylaman gerekiyor.';
    const view = (e) => res.status(400).render('orders/payout', { title: 'Ödeme Bilgilerim', acc: old, form: { ...form, iban: '', tckn: '' }, next: nextUrl, error: e, noindex: true });
    if (error) return view(error);

    const p = provider();
    if (!p) return view('Kargolu satış şu an kapalı.');
    let key;
    try {
      ({ subMerchantKey: key } = await p.registerSeller(req.user, { ...form, phoneE164: phoneE164(form.phone), sub_merchant_key: old && old.sub_merchant_key }));
    } catch (e) {
      console.error('Alt üye kaydı:', e.message);
      return view('Ödeme kuruluşu bilgilerini doğrulayamadı. Bilgileri kontrol edip tekrar dene.');
    }
    putAcc.run(req.user.id, form.first_name, form.last_name, form.phone, form.address, box.seal(form.iban), form.iban.slice(-4), box.seal(form.tckn), key);
    h.flash(req, 'success', 'Ödeme bilgilerin kaydedildi. Artık ilanlarında "Kargoyla satış" açabilirsin.');
    res.redirect(nextUrl !== '/' ? nextUrl : '/hesabim');
  } catch (e) { next(e); }
});

// ---- Satın al ----
const getListing = db.prepare(`SELECT l.*, u.name AS seller_name FROM listings l JOIN users u ON u.id = l.user_id WHERE l.id = ?`);

function satinAlinabilir(l, user) {
  if (!l || l.status !== 'active' || !l.shipping || !(l.price > 0)) return 'Bu ilan kargoyla satın alınamıyor.';
  if (!provider()) return 'Kargolu satış şu an kapalı.';
  if (user && user.id === l.user_id) return 'Kendi ilanını satın alamazsın.';
  const acc = getAcc.get(l.user_id);
  if (!acc || !acc.sub_merchant_key) return 'Satıcının ödeme bilgileri eksik.';
  if (orders.listingBusy(l.id)) return 'Bu ürün şu anda başka biri tarafından satın alınıyor.';
  return null;
}

// Kabul edilmiş fiyat teklifi varsa ürün fiyatı teklif tutarı olur
function teklifliFiyat(req, l) {
  const id = parseInt(req.query.teklif || req.body.teklif, 10) || 0;
  if (!id) return { l, teklif: null };
  const o = require('../lib/teklif').kabulEdilen(l.id, req.user.id, id);
  return o ? { l: { ...l, price: o.amount }, teklif: o } : { l, teklif: null, gecersiz: true };
}

router.get('/ilan/:id/satin-al', h.requireLogin, h.requireVerified, (req, res, next) => {
  const ham = getListing.get(parseInt(req.params.id, 10) || 0);
  if (!ham) return next();
  const err = satinAlinabilir(ham, req.user);
  if (err) { h.flash(req, 'error', err); return res.redirect(h.ilanUrl(ham)); }
  const { l, teklif, gecersiz } = teklifliFiyat(req, ham);
  if (gecersiz) { h.flash(req, 'error', 'Bu teklif artık geçerli değil.'); return res.redirect(h.ilanUrl(ham)); }
  res.render('orders/checkout', { title: 'Kargoyla Satın Al', ilan: l, teklif, tutar: orders.hesapla(l), form: { ship_name: req.user.name, ship_phone: req.user.phone || '' }, noindex: true });
});

const insOrder = db.prepare(`INSERT INTO orders (listing_id, buyer_id, seller_id, title, item_price, shipping_fee, service_fee, total,
  ship_name, ship_phone, ship_il, ship_ilce, ship_address, provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

router.post('/ilan/:id/satin-al', h.requireLogin, h.requireVerified, rateLimit('satin-al', 20, 60), h.verifyCsrf, async (req, res, next) => {
  try {
    const ham = getListing.get(parseInt(req.params.id, 10) || 0);
    if (!ham) return next();
    const err = satinAlinabilir(ham, req.user);
    if (err) { h.flash(req, 'error', err); return res.redirect(h.ilanUrl(ham)); }
    const { l, teklif, gecersiz } = teklifliFiyat(req, ham);
    if (gecersiz) { h.flash(req, 'error', 'Bu teklif artık geçerli değil.'); return res.redirect(h.ilanUrl(ham)); }
    const form = {
      ship_name: h.str(req.body.ship_name, 80), ship_phone: h.str(req.body.ship_phone, 20),
      ship_il: h.str(req.body.il, 60), ship_ilce: h.str(req.body.ilce, 60), ship_address: h.str(req.body.ship_address, 300),
    };
    const tutar = orders.hesapla(l);
    let error = null;
    if (form.ship_name.split(' ').filter(Boolean).length < 2) error = 'Alıcı adını ve soyadını yaz.';
    else if (!phoneE164(form.ship_phone)) error = 'Geçerli bir cep telefonu gir.';
    else if (!getIlce(form.ship_il, form.ship_ilce)) error = 'Teslimat ilini ve ilçesini seç.';
    else if (form.ship_address.length < 15) error = 'Açık adresi (mahalle, sokak, no, daire) yaz.';
    else if (!req.body.onay) error = 'Mesafeli satış ve ödeme koşullarını onayla.';
    if (error) return res.status(400).render('orders/checkout', { title: 'Kargoyla Satın Al', ilan: l, teklif, tutar, form, error, noindex: true });

    const p = provider();
    const info = insOrder.run(l.id, req.user.id, l.user_id, l.title, tutar.urun, tutar.kargo, tutar.hizmet, tutar.toplam,
      form.ship_name, phoneE164(form.ship_phone), form.ship_il, form.ship_ilce, form.ship_address, p.name);
    const id = Number(info.lastInsertRowid);
    const code = 'SP' + String(id).padStart(6, '0');
    db.prepare('UPDATE orders SET code = ?, offer_id = ? WHERE id = ?').run(code, teklif ? teklif.id : null, id);
    let o = orders.byId(id);
    orders.setStatus(o, 'odeme_bekliyor', {}, 'Sipariş oluşturuldu');

    const start = await p.startCheckout(o, {
      buyer: req.user, ip: req.ip, ilAdi: getIl(form.ship_il).ad,
      callbackUrl: `${h.baseUrl(req)}/odeme/sonuc`,
      subMerchantKey: getAcc.get(l.user_id).sub_merchant_key,
    });
    db.prepare('UPDATE orders SET pay_token = ? WHERE id = ?').run(start.token, id);
    if (start.html) { req.session.payHtml = { code, html: start.html }; return res.redirect(`/siparis/${code}/odeme`); }
    res.redirect(start.redirect || start.pageUrl);
  } catch (e) {
    console.error('Ödeme başlatılamadı:', e.message);
    h.flash(req, 'error', 'Ödeme başlatılamadı. Lütfen biraz sonra tekrar dene.');
    res.redirect('back');
  }
});

// iyzico ödeme formu (iyzico'nun verdiği HTML/JS)
router.get('/siparis/:code/odeme', h.requireLogin, (req, res, next) => {
  const o = orders.byCode(req.params.code);
  const ph = req.session.payHtml;
  if (!o || o.buyer_id !== req.user.id || o.status !== 'odeme_bekliyor' || !ph || ph.code !== o.code) return next();
  res.render('orders/pay', { title: 'Ödeme', o, html: ph.html, noindex: true });
});

// Test ödeme sayfası (yalnızca test modunda)
router.get('/siparis/:code/test-odeme', h.requireLogin, (req, res, next) => {
  const o = orders.byCode(req.params.code);
  if (!o || o.provider !== 'test' || o.buyer_id !== req.user.id || o.status !== 'odeme_bekliyor') return next();
  res.render('orders/test-pay', { title: 'Test Ödeme', o, noindex: true });
});
router.post('/siparis/:code/test-odeme', h.requireLogin, h.verifyCsrf, async (req, res, next) => {
  const o = orders.byCode(req.params.code);
  if (!o || o.provider !== 'test' || o.buyer_id !== req.user.id || o.status !== 'odeme_bekliyor') return next();
  if (req.body.sonuc !== 'basarili') {
    orders.setStatus(o, 'iptal', { closed_at: new Date().toISOString() }, 'Ödeme başarısız (test)');
    h.flash(req, 'error', 'Ödeme başarısız oldu (test).');
    return res.redirect(`/siparis/${o.code}`);
  }
  const r = await provider().finishCheckout(o.pay_token, o);
  orders.odendi(o, r);
  h.flash(req, 'success', 'Ödemen alındı! Para, ürün eline ulaşana kadar güvende bekleyecek.');
  res.redirect(`/siparis/${o.code}`);
});

// iyzico geri dönüşü: tarayıcı iyzico sitesinden POST ile gelir. Bu istekte oturum çerezi gelmez,
// bu yüzden burada oturuma dokunmuyoruz (yoksa kullanıcının oturumu düşer); sonucu adres ile taşıyoruz.
router.post('/odeme/sonuc', rateLimit('odeme-sonuc', 60, 10), async (req, res) => {
  const token = h.str(req.body.token, 200);
  const o = token ? db.prepare('SELECT * FROM orders WHERE pay_token = ?').get(token) : null;
  if (!o) return res.status(404).render('error', { title: 'Sipariş bulunamadı', message: 'Ödeme sonucu bir siparişle eşleşmedi.' });
  if (o.status !== 'odeme_bekliyor') return res.redirect(303, `/siparis/${o.code}`);
  let sonuc = 'hata';
  try {
    const r = await provider().finishCheckout(token, o);
    if (r.ok) { orders.odendi(o, r); sonuc = 'ok'; }
    else orders.setStatus(o, 'iptal', { closed_at: new Date().toISOString() }, r.error);
  } catch (e) {
    console.error('Ödeme sonucu alınamadı:', o.code, e.message);
    sonuc = 'dogrulanamadi';
  }
  res.redirect(303, `/siparis/${o.code}?odeme=${sonuc}`);
});

// ---- Sipariş sayfası ----
const events = db.prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY id');
function load(req) {
  const o = orders.byCode(req.params.code);
  if (!o || !req.user) return null;
  const rol = o.buyer_id === req.user.id ? 'alici' : o.seller_id === req.user.id ? 'satici' : req.user.is_admin ? 'yonetici' : null;
  return rol ? { o, rol } : null;
}

router.get('/siparis/:code', h.requireLogin, (req, res, next) => {
  const t = load(req);
  if (!t) return next();
  const karsi = db.prepare('SELECT id, name FROM users WHERE id = ?').get(t.rol === 'satici' ? t.o.buyer_id : t.o.seller_id);
  res.render('orders/order', {
    title: `Sipariş ${t.o.code}`, ...t, karsi, olaylar: events.all(t.o.id), noindex: true,
    DURUMLAR: orders.DURUMLAR, FIRMALAR: orders.KARGO_FIRMALARI, SURELER: orders.SURELER, ilAdi: getIl(t.o.ship_il).ad, ilceAdi: getIlce(t.o.ship_il, t.o.ship_ilce).ad,
  });
});

router.post('/siparis/:code/kargo', h.requireLogin, h.verifyCsrf, (req, res, next) => {
  const t = load(req);
  if (!t || t.rol !== 'satici' || t.o.status !== 'odendi') return next();
  const carrier = orders.KARGO_FIRMALARI.some((k) => k.key === req.body.carrier) ? req.body.carrier : null;
  const tracking = h.str(req.body.tracking_no, 40).replace(/\s+/g, '');
  if (!carrier || tracking.length < 5) { h.flash(req, 'error', 'Kargo firmasını seç ve takip numarasını yaz.'); return res.redirect(`/siparis/${t.o.code}`); }
  orders.kargoya(t.o, carrier, tracking);
  h.flash(req, 'success', 'Kargo bilgisi alıcıya iletildi.');
  res.redirect(`/siparis/${t.o.code}`);
});

router.post('/siparis/:code/teslim', h.requireLogin, h.verifyCsrf, async (req, res, next) => {
  const t = load(req);
  if (!t || t.rol !== 'alici' || t.o.status !== 'kargoda') return next();
  try {
    await orders.tamamla(t.o, 'Alıcı teslim aldığını onayladı');
    h.flash(req, 'success', 'Teşekkürler! Ödeme satıcıya aktarıldı. Satıcıyı mesajlaşma sayfasından puanlayabilirsin.');
  } catch (e) {
    console.error(e); h.flash(req, 'error', 'Onay şu an işlenemedi, lütfen biraz sonra tekrar dene.');
  }
  res.redirect(`/siparis/${t.o.code}`);
});

router.post('/siparis/:code/sorun', h.requireLogin, h.verifyCsrf, (req, res, next) => {
  const t = load(req);
  if (!t || t.rol !== 'alici' || !['odendi', 'kargoda'].includes(t.o.status)) return next();
  const reason = [h.str(req.body.reason, 60), h.str(req.body.detail, 800)].filter(Boolean).join(' — ');
  if (!reason) { h.flash(req, 'error', 'Sorunu kısaca anlat.'); return res.redirect(`/siparis/${t.o.code}`); }
  orders.itiraz(t.o, reason);
  h.flash(req, 'success', 'Bildirimin alındı. Ödeme, inceleme bitene kadar satıcıya aktarılmayacak.');
  res.redirect(`/siparis/${t.o.code}`);
});

router.post('/siparis/:code/iptal', h.requireLogin, h.verifyCsrf, async (req, res, next) => {
  const t = load(req);
  if (!t) return next();
  const { o, rol } = t;
  const izin = (rol === 'alici' && o.status === 'odeme_bekliyor') || (rol === 'satici' && o.status === 'odendi');
  if (!izin) return next();
  try {
    await orders.iadeEt(o, rol === 'satici' ? 'Satıcı siparişi iptal etti' : 'Alıcı ödemeden vazgeçti');
    h.flash(req, 'success', rol === 'satici' ? 'Sipariş iptal edildi, alıcıya iade yapıldı.' : 'Sipariş iptal edildi.');
  } catch (e) {
    console.error(e); h.flash(req, 'error', 'İptal şu an işlenemedi.');
  }
  res.redirect(`/siparis/${o.code}`);
});

// ---- Siparişlerim ----
router.get('/siparislerim', h.requireLogin, (req, res) => {
  const tab = req.query.tab === 'satis' ? 'satis' : 'alis';
  const rows = db.prepare(`SELECT o.*, l.image FROM orders o JOIN listings l ON l.id = o.listing_id
    WHERE o.${tab === 'satis' ? 'seller_id' : 'buyer_id'} = ? AND NOT (o.status = 'iptal' AND o.paid_at IS NULL AND o.created_at < datetime('now','-1 day'))
    ORDER BY o.id DESC LIMIT 200`).all(req.user.id);
  res.render('orders/list', { title: 'Siparişlerim', tab, rows, DURUMLAR: orders.DURUMLAR, noindex: true });
});

module.exports = router;
module.exports.satinAlinabilir = satinAlinabilir;
module.exports.getAcc = getAcc;
