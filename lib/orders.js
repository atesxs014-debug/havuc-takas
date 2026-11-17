// Güvenli ödemeli kargo siparişleri: ücretler, durum geçişleri, otomatik işlemler
const db = require('./db');
const { provider } = require('./payments');
const mail = require('./mail');
const config = require('./config');

const PAKETLER = [
  { key: 'kucuk', ad: 'Küçük paket', aciklama: 'Telefon, kitap, giysi (≈ 1-3 desi)', varsayilan: 90 },
  { key: 'orta', ad: 'Orta paket', aciklama: 'Ayakkabı kutusu, küçük ev aleti (≈ 4-10 desi)', varsayilan: 130 },
  { key: 'buyuk', ad: 'Büyük paket', aciklama: 'Bisiklet, sandalye vb. (≈ 11-30 desi)', varsayilan: 220 },
];
const DURUMLAR = {
  odeme_bekliyor: 'Ödeme bekleniyor',
  odendi: 'Ödendi · Kargoya verilmesi bekleniyor',
  kargoda: 'Kargoda',
  itiraz: 'Sorun bildirildi · İnceleniyor',
  tamamlandi: 'Tamamlandı',
  iade: 'İade edildi',
  iptal: 'İptal edildi',
};
const KARGO_FIRMALARI = [
  { key: 'yurtici', ad: 'Yurtiçi Kargo', site: 'https://www.yurticikargo.com' },
  { key: 'aras', ad: 'Aras Kargo', site: 'https://www.araskargo.com.tr' },
  { key: 'mng', ad: 'MNG Kargo', site: 'https://www.mngkargo.com.tr' },
  { key: 'ptt', ad: 'PTT Kargo', site: 'https://gonderitakip.ptt.gov.tr' },
  { key: 'surat', ad: 'Sürat Kargo', site: 'https://www.suratkargo.com.tr' },
  { key: 'hepsijet', ad: 'HepsiJet', site: 'https://www.hepsijet.com' },
  { key: 'diger', ad: 'Diğer', site: null },
];
const SURELER = { odemeDk: 30, kargoGun: 3, onayGun: 7 };

function ayarlar() {
  const s = { hizmetYuzde: Number(db.setting('hizmet_yuzde', 5)), hizmetMin: Number(db.setting('hizmet_min', 10)) };
  for (const p of PAKETLER) s[p.key] = Number(db.setting('kargo_' + p.key, p.varsayilan));
  return s;
}
function setAyarlar(b) {
  const n = (v) => { const x = parseFloat(String(v).replace(',', '.')); return Number.isFinite(x) && x >= 0 ? x : null; };
  for (const p of PAKETLER) if (n(b['kargo_' + p.key]) != null) db.setSetting('kargo_' + p.key, Math.round(n(b['kargo_' + p.key])));
  if (n(b.hizmet_yuzde) != null) db.setSetting('hizmet_yuzde', Math.min(30, n(b.hizmet_yuzde)));
  if (n(b.hizmet_min) != null) db.setSetting('hizmet_min', Math.round(n(b.hizmet_min)));
}

/** Alıcının ödeyeceği tutarlar (TL, tam sayı) */
function hesapla(listing) {
  const a = ayarlar();
  const kargo = a[listing.package_size] ?? a.orta;
  const hizmet = Math.max(a.hizmetMin, Math.round(listing.price * a.hizmetYuzde / 100));
  return { urun: listing.price, kargo, hizmet, toplam: listing.price + kargo + hizmet };
}

const q = {
  byId: db.prepare('SELECT * FROM orders WHERE id = ?'),
  byCode: db.prepare('SELECT * FROM orders WHERE code = ?'),
  event: db.prepare('INSERT INTO order_events (order_id, status, note) VALUES (?, ?, ?)'),
  user: db.prepare('SELECT id, name, email FROM users WHERE id = ?'),
  admins: db.prepare('SELECT email FROM users WHERE is_admin = 1'),
  listingStatus: db.prepare('UPDATE listings SET status = ? WHERE id = ?'),
  openOrder: db.prepare(`SELECT id FROM orders WHERE listing_id = ? AND (status IN ('odendi','kargoda','itiraz','tamamlandi')
    OR (status = 'odeme_bekliyor' AND created_at > datetime('now', ?)))`),
};

const base = () => config.SITE_URL || `http://localhost:${config.PORT}`;
const tl = (n) => new Intl.NumberFormat('tr-TR').format(n) + ' TL';
const link = (o) => `${base()}/siparis/${o.code}`;

/** Başka biri şu an satın alıyor ya da satın almış mı? */
function listingBusy(listingId) {
  return !!q.openOrder.get(listingId, `-${SURELER.odemeDk} minutes`);
}

function setStatus(o, status, fields = {}, note = null) {
  const cols = Object.keys(fields);
  db.prepare(`UPDATE orders SET status = ?${cols.map((c) => `, ${c} = ?`).join('')} WHERE id = ?`).run(status, ...cols.map((c) => fields[c]), o.id);
  q.event.run(o.id, status, note);
  return q.byId.get(o.id);
}

function haber(userId, subject, title, lines, o) {
  const u = q.user.get(userId);
  if (u) mail.send({ to: u.email, subject, title, lines, button: { text: 'Siparişi görüntüle', url: link(o) } });
}

// ---- Durum geçişleri ----
function odendi(o, { paymentId, txIds }) {
  const n = setStatus(o, 'odendi', { payment_id: paymentId, tx_ids: JSON.stringify(txIds), paid_at: new Date().toISOString() }, 'Ödeme alındı');
  q.listingStatus.run('sold', o.listing_id);
  haber(o.seller_id, `📦 "${o.title}" satıldı! ${SURELER.kargoGun} gün içinde kargoya ver`, 'Ürünün kargoyla satıldı',
    [`Alıcı ödemeyi yaptı, para güvende bekliyor. Ürünü ${SURELER.kargoGun} gün içinde kargoya verip takip numarasını gir.`,
      `Alıcı: ${o.ship_name}, ${o.ship_phone}`, `Adres: ${o.ship_address}`, `Kargo ücreti (${tl(o.shipping_fee)}) ödemenle birlikte sana aktarılır.`], n);
  haber(o.buyer_id, `Ödemen alındı (${o.code})`, 'Ödemen alındı',
    ['Paran ürün sana ulaşana kadar güvende bekliyor. Satıcı kargoya verince takip numarasını sana bildireceğiz.'], n);
  return n;
}

function kargoya(o, carrier, tracking) {
  const firma = KARGO_FIRMALARI.find((k) => k.key === carrier);
  const n = setStatus(o, 'kargoda', { carrier, tracking_no: tracking, shipped_at: new Date().toISOString() }, `${firma ? firma.ad : carrier} · ${tracking}`);
  haber(o.buyer_id, `🚚 Siparişin kargoda (${o.code})`, 'Siparişin kargoya verildi',
    [`${firma ? firma.ad : carrier} · Takip no: ${tracking}`,
      `Ürün eline ulaşınca kontrol et ve "Teslim aldım" butonuna bas. Sorun varsa ${SURELER.onayGun} gün içinde "Sorun var" de; aksi hâlde ödeme otomatik olarak satıcıya aktarılır.`], n);
  return n;
}

async function tamamla(o, note) {
  const p = provider();
  if (p && p.name === o.provider) await p.release(o);
  else if (o.provider !== 'test') throw new Error('Ödeme sağlayıcısı kullanılamıyor.');
  const n = setStatus(o, 'tamamlandi', { completed_at: new Date().toISOString(), payout_done: 1 }, note);
  haber(o.seller_id, `💸 Ödemen aktarılıyor (${o.code})`, 'Satış tamamlandı',
    [`"${o.title}" için ${tl(o.item_price + o.shipping_fee)} hesabına aktarılmak üzere onaylandı. Aktarım süresi ödeme kuruluşuna bağlıdır.`], n);
  return n;
}

async function iadeEt(o, note) {
  if (o.status === 'odeme_bekliyor') return setStatus(o, 'iptal', { closed_at: new Date().toISOString() }, note);
  const p = provider();
  if (p && p.name === o.provider) await p.refund(o);
  else if (o.provider !== 'test') throw new Error('Ödeme sağlayıcısı kullanılamıyor.');
  const n = setStatus(o, 'iade', { closed_at: new Date().toISOString() }, note);
  q.listingStatus.run('active', o.listing_id);
  haber(o.buyer_id, `↩️ İaden yapıldı (${o.code})`, 'Ödemen iade edildi',
    [`"${o.title}" siparişin için ${tl(o.total)} kartına iade edildi. Bankana yansıması birkaç iş günü sürebilir.`, note ? `Not: ${note}` : ''].filter(Boolean), n);
  haber(o.seller_id, `Sipariş iade edildi (${o.code})`, 'Sipariş iade edildi', [`"${o.title}" siparişi iade edildi.`, note ? `Not: ${note}` : ''].filter(Boolean), n);
  return n;
}

function itiraz(o, reason) {
  const n = setStatus(o, 'itiraz', { dispute_reason: reason }, reason);
  haber(o.seller_id, `⚠️ Alıcı sorun bildirdi (${o.code})`, 'Alıcı siparişle ilgili sorun bildirdi',
    [`Sorun: ${reason}`, 'Ödeme ekibimiz inceleyene kadar bekletilecek. Alıcıyla mesajlaşarak çözebilirsiniz.'], n);
  for (const a of q.admins.all()) mail.send({ to: a.email, subject: `İtiraz: ${o.code}`, title: 'Siparişe itiraz', lines: [reason], button: { text: 'İncele', url: `${base()}/yonetim?tab=siparis` } });
  return n;
}

// ---- Zamanlanmış kontroller ----
async function otomatik() {
  // 1) Süresi geçen ödeme bekleyen siparişler
  db.prepare(`SELECT * FROM orders WHERE status = 'odeme_bekliyor' AND created_at <= datetime('now', ?)`).all(`-${SURELER.odemeDk * 2} minutes`)
    .forEach((o) => setStatus(o, 'iptal', { closed_at: new Date().toISOString() }, 'Ödeme yapılmadı'));
  // 2) Kargoya verilmeyenler: 2. gün hatırlat, 3. gün iade
  for (const o of db.prepare(`SELECT * FROM orders WHERE status = 'odendi' AND reminded = 0 AND paid_at <= ?`).all(new Date(Date.now() - 2 * 86400000).toISOString())) {
    haber(o.seller_id, `⏰ Kargoya vermeyi unutma (${o.code})`, 'Siparişi kargoya vermeyi unutma',
      [`"${o.title}" yarın kargoya verilmezse sipariş iptal edilip alıcıya iade edilecek.`], o);
    db.prepare('UPDATE orders SET reminded = 1 WHERE id = ?').run(o.id);
  }
  for (const o of db.prepare(`SELECT * FROM orders WHERE status = 'odendi' AND paid_at <= ?`).all(new Date(Date.now() - SURELER.kargoGun * 86400000).toISOString())) {
    try { await iadeEt(o, `Satıcı ${SURELER.kargoGun} gün içinde kargoya vermedi`); } catch (e) { console.error('Otomatik iade hatası', o.code, e.message); }
  }
  // 3) Kargoda olup alıcı onaylamayanlar: süre dolunca otomatik tamamla
  for (const o of db.prepare(`SELECT * FROM orders WHERE status = 'kargoda' AND shipped_at <= ?`).all(new Date(Date.now() - SURELER.onayGun * 86400000).toISOString())) {
    try { await tamamla(o, `${SURELER.onayGun} gün içinde sorun bildirilmedi, otomatik onaylandı`); } catch (e) { console.error('Otomatik onay hatası', o.code, e.message); }
  }
}

module.exports = { PAKETLER, DURUMLAR, KARGO_FIRMALARI, SURELER, ayarlar, setAyarlar, hesapla, listingBusy, setStatus,
  odendi, kargoya, tamamla, iadeEt, itiraz, otomatik, byCode: (c) => q.byCode.get(c), byId: (i) => q.byId.get(i) };
