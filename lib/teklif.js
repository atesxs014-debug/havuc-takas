// Teklifler: alıcı fiyat teklif eder ya da kendi ilanıyla takas önerir; satıcı kabul eder, reddeder veya karşı teklif verir.
// Kabul edilen fiyat teklifi, ilan kargoluysa o fiyattan güvenli satın almayı açar.
const db = require('./db');
const config = require('./config');
const { send } = require('./mail');
const bildirim = require('./bildirim');
const engel = require('./engel');

const GECERLILIK_GUN = 7;
const DURUMLAR = {
  bekliyor: 'Satıcının cevabı bekleniyor',
  karsi: 'Satıcı karşı teklif verdi',
  kabul: 'Kabul edildi',
  red: 'Reddedildi',
  iptal: 'Geri çekildi',
  suresi_doldu: 'Süresi doldu',
};

const base = () => config.SITE_URL || `http://localhost:${config.PORT}`;
const tl = (n) => new Intl.NumberFormat('tr-TR').format(n) + ' TL';

const q = {
  byId: db.prepare('SELECT * FROM offers WHERE id = ?'),
  listing: db.prepare('SELECT * FROM listings WHERE id = ?'),
  user: db.prepare('SELECT id, name, email, notify_email FROM users WHERE id = ?'),
  ins: db.prepare(`INSERT INTO offers (listing_id, buyer_id, seller_id, kind, amount, swap_listing_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)`),
  acik: db.prepare("SELECT * FROM offers WHERE listing_id = ? AND buyer_id = ? AND status IN ('bekliyor', 'karsi') ORDER BY id DESC LIMIT 1"),
  sonBenim: db.prepare('SELECT * FROM offers WHERE listing_id = ? AND buyer_id = ? ORDER BY id DESC LIMIT 1'),
  geriCek: db.prepare("UPDATE offers SET status = 'iptal', updated_at = datetime('now') WHERE listing_id = ? AND buyer_id = ? AND status IN ('bekliyor', 'karsi')"),
  set: db.prepare("UPDATE offers SET status = ?, amount = COALESCE(?, amount), counter_amount = COALESCE(?, counter_amount), updated_at = datetime('now') WHERE id = ?"),
  bekleyenSayisi: db.prepare("SELECT COUNT(*) AS n FROM offers WHERE listing_id = ? AND status = 'bekliyor'"),
  gelen: db.prepare(`SELECT o.*, l.title, l.price AS listing_price, l.status AS listing_status, l.image, l.category, u.name AS buyer_name,
      s.title AS swap_title, s.image AS swap_image, s.status AS swap_status
    FROM offers o JOIN listings l ON l.id = o.listing_id JOIN users u ON u.id = o.buyer_id LEFT JOIN listings s ON s.id = o.swap_listing_id
    WHERE o.seller_id = ? ORDER BY o.status NOT IN ('bekliyor', 'karsi'), o.updated_at DESC LIMIT 100`),
  giden: db.prepare(`SELECT o.*, l.title, l.price AS listing_price, l.status AS listing_status, l.image, l.category, l.shipping, u.name AS seller_name,
      s.title AS swap_title, s.image AS swap_image
    FROM offers o JOIN listings l ON l.id = o.listing_id JOIN users u ON u.id = o.seller_id LEFT JOIN listings s ON s.id = o.swap_listing_id
    WHERE o.buyer_id = ? ORDER BY o.status NOT IN ('karsi', 'kabul', 'bekliyor'), o.updated_at DESC LIMIT 100`),
  takaslik: db.prepare("SELECT id, title FROM listings WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 50"),
  eski: db.prepare(`UPDATE offers SET status = 'suresi_doldu', updated_at = datetime('now')
    WHERE status IN ('bekliyor', 'karsi') AND updated_at < datetime('now', '-${GECERLILIK_GUN} days')`),
  kapanan: db.prepare(`UPDATE offers SET status = 'suresi_doldu', updated_at = datetime('now')
    WHERE status IN ('bekliyor', 'karsi') AND listing_id IN (SELECT id FROM listings WHERE status != 'active')`),
};

function haber(userId, text, subject, lines, url = '/tekliflerim') {
  bildirim.ekle(userId, text, url, '🤝');
  const u = q.user.get(userId);
  if (u && u.notify_email) send({ to: u.email, subject, title: subject, lines, button: { text: 'Teklifi görüntüle', url: base() + url } });
}

const teklifMetni = (o, l) => (o.kind === 'takas' ? `"${(q.listing.get(o.swap_listing_id) || {}).title || 'bir ilan'}" ile takas` : tl(o.amount));

/** Teklif verir. Hata varsa metin, başarılıysa null döner. */
function ver(user, l, { kind, amount, swapId, note }) {
  if (!l || l.status !== 'active') return 'Bu ilan artık yayında değil.';
  if (l.user_id === user.id) return 'Kendi ilanına teklif veremezsin.';
  if (engel.arasinda(user.id, l.user_id)) return 'Bu kişiyle iletişim engelli.';
  if (kind === 'fiyat') {
    if (!(l.price > 0)) return 'Bu ilan için fiyat teklifi verilemez.';
    if (!(amount >= 1)) return 'Teklif tutarını yaz.';
    if (amount >= l.price) return `Teklifin ilan fiyatından (${tl(l.price)}) düşük olmalı. Bu fiyata almak istiyorsan satıcıya yaz.`;
    if (amount < Math.ceil(l.price * 0.3)) return 'Bu teklif ilan fiyatına göre çok düşük. Biraz daha yükselt.';
    swapId = null;
  } else if (kind === 'takas') {
    if (!l.is_swap) return 'Satıcı bu ilanı takasa açmamış.';
    const s = q.listing.get(swapId || 0);
    if (!s || s.user_id !== user.id || s.status !== 'active') return 'Takas için kendi yayındaki ilanlarından birini seç.';
    amount = null;
  } else return 'Teklif türünü seç.';
  q.geriCek.run(l.id, user.id); // önceki açık teklif yerine yenisi geçer
  q.ins.run(l.id, user.id, l.user_id, kind, amount, swapId, note || null);
  const o = { kind, amount, swap_listing_id: swapId };
  haber(l.user_id, `${user.name} "${l.title}" için teklif verdi: ${teklifMetni(o)}`, `🤝 "${l.title}" için yeni teklif`,
    [`${user.name} ilanına teklif verdi: ${teklifMetni(o)}.`, note ? `Notu: "${note}"` : '', `Teklif ${GECERLILIK_GUN} gün içinde cevaplanmazsa düşer.`].filter(Boolean));
  return null;
}

/** Cevap: kabul | red | karsi (satıcı) · kabul | red | iptal (alıcı, karşı teklife) */
function cevapla(user, id, islem, karsiTutar) {
  const o = q.byId.get(id);
  if (!o) return { hata: 'Teklif bulunamadı.' };
  const l = q.listing.get(o.listing_id);
  const satici = o.seller_id === user.id;
  const alici = o.buyer_id === user.id;
  if (!satici && !alici) return { hata: 'Teklif bulunamadı.' };
  if (!l || l.status !== 'active') return { hata: 'İlan artık yayında değil.' };
  const url = `/tekliflerim`;

  if (alici && islem === 'iptal' && ['bekliyor', 'karsi'].includes(o.status)) {
    q.set.run('iptal', null, null, o.id);
    return { ok: 'Teklifini geri çektin.' };
  }
  if (satici && o.status === 'bekliyor') {
    if (islem === 'kabul') {
      q.set.run('kabul', null, null, o.id);
      haber(o.buyer_id, `"${l.title}" için teklifin kabul edildi 🎉`, `🎉 Teklifin kabul edildi: ${l.title}`,
        [o.kind === 'fiyat' ? `Satıcı ${tl(o.amount)} teklifini kabul etti.` + (l.shipping ? ' Şimdi bu fiyattan kargoyla güvenli satın alabilirsin.' : ' Teslimatı mesajlaşarak ayarlayın.')
          : 'Satıcı takas teklifini kabul etti. Buluşma ya da kargo için mesajlaşın.']);
      return { ok: 'Teklifi kabul ettin. Alıcıya haber verdik.' };
    }
    if (islem === 'red') {
      q.set.run('red', null, null, o.id);
      haber(o.buyer_id, `"${l.title}" için teklifin reddedildi`, `Teklifin reddedildi: ${l.title}`, ['Satıcı bu teklifi kabul etmedi. İstersen yeni bir teklif verebilirsin.']);
      return { ok: 'Teklifi reddettin.' };
    }
    if (islem === 'karsi') {
      if (o.kind !== 'fiyat') return { hata: 'Takas teklifine karşı teklif verilemez; mesajla konuş.' };
      if (!(karsiTutar > o.amount && karsiTutar <= l.price)) return { hata: `Karşı teklif ${tl(o.amount + 1)} ile ${tl(l.price)} arasında olmalı.` };
      q.set.run('karsi', null, karsiTutar, o.id);
      haber(o.buyer_id, `"${l.title}" için satıcı karşı teklif verdi: ${tl(karsiTutar)}`, `🤝 Karşı teklif: ${l.title}`,
        [`Senin teklifin ${tl(o.amount)} idi; satıcı ${tl(karsiTutar)} öneriyor. Kabul edebilir ya da reddedebilirsin.`]);
      return { ok: 'Karşı teklifini gönderdin.' };
    }
  }
  if (alici && o.status === 'karsi') {
    if (islem === 'kabul') {
      q.set.run('kabul', o.counter_amount, null, o.id);
      haber(o.seller_id, `"${l.title}" için karşı teklifin kabul edildi: ${tl(o.counter_amount)}`, `🎉 Karşı teklifin kabul edildi: ${l.title}`,
        [`Alıcı ${tl(o.counter_amount)} fiyatını kabul etti.` + (l.shipping ? ' Alıcı bu fiyattan kargoyla satın alabilir.' : ' Teslimatı mesajlaşarak ayarlayın.')]);
      return { ok: 'Karşı teklifi kabul ettin.' };
    }
    if (islem === 'red') {
      q.set.run('red', null, null, o.id);
      haber(o.seller_id, `"${l.title}" için karşı teklifin reddedildi`, `Karşı teklifin reddedildi: ${l.title}`, ['Alıcı karşı teklifini kabul etmedi.']);
      return { ok: 'Karşı teklifi reddettin.' };
    }
  }
  return { hata: 'Bu teklif için bu işlem yapılamaz.' };
}

/** Alıcının bu ilan için kabul edilmiş fiyat teklifi (kargolu satın almada fiyatı belirler) */
function kabulEdilen(listingId, buyerId, offerId) {
  const o = q.byId.get(offerId || 0);
  if (!o || o.listing_id !== listingId || o.buyer_id !== buyerId || o.kind !== 'fiyat' || o.status !== 'kabul') return null;
  if (o.updated_at < new Date(Date.now() - GECERLILIK_GUN * 864e5).toISOString().replace('T', ' ').slice(0, 19)) return null;
  return o;
}

function temizle() { q.eski.run(); q.kapanan.run(); }

module.exports = {
  DURUMLAR, GECERLILIK_GUN, ver, cevapla, kabulEdilen, temizle,
  benimSon: (lid, uid) => q.sonBenim.get(lid, uid),
  bekleyenSayisi: (lid) => q.bekleyenSayisi.get(lid).n,
  gelen: (uid) => q.gelen.all(uid),
  giden: (uid) => q.giden.all(uid),
  takaslik: (uid) => q.takaslik.all(uid),
};
