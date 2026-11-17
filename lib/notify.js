// E-posta bildirimleri
const db = require('./db');
const config = require('./config');
const { send } = require('./mail');
const { konumAdi } = require('./locations');

const base = () => config.SITE_URL || `http://localhost:${config.PORT}`;
const tl = (n) => (n == null ? '-' : new Intl.NumberFormat('tr-TR').format(n) + ' TL');
const userById = db.prepare('SELECT id, name, email, notify_email FROM users WHERE id = ?');
const admins = db.prepare('SELECT email FROM users WHERE is_admin = 1');
const konum = (ad) => konumAdi(ad.il, ad.ilce) + (ad.ilce ? '' : ' (il geneli)');

function odemeSatirlari(tutar, ref) {
  const b = config.bank;
  if (!b.iban) return [`Ödeme bilgileri için sizinle iletişime geçeceğiz. Referans kodunuz: ${ref}`];
  return [
    `Ödenecek tutar: ${tl(tutar)}`,
    `IBAN: ${b.iban}${b.holder ? ' — Alıcı: ' + b.holder : ''}${b.name ? ' (' + b.name + ')' : ''}`,
    `Açıklama kısmına mutlaka şu referans kodunu yazın: ${ref}`,
    'Ödemeniz kontrol edildikten sonra reklamınız yayına alınır.',
  ];
}

// Yeni mesaj: alıcının bu konuşmada okunmamış başka mesajı yoksa e-posta at (spam olmasın)
const unreadInThread = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE listing_id = ? AND sender_id = ? AND receiver_id = ? AND read_at IS NULL');
function newMessage({ listing, senderId, receiverId, body }) {
  const r = userById.get(receiverId);
  const s = userById.get(senderId);
  if (!r || !s || !r.notify_email) return;
  if (unreadInThread.get(listing.id, senderId, receiverId).n > 1) return;
  send({
    to: r.email,
    subject: `💬 ${s.name} size mesaj gönderdi: ${listing.title}`,
    title: `${s.name} "${listing.title}" ilanı için mesaj gönderdi`,
    lines: [body.length > 300 ? body.slice(0, 300) + '…' : body],
    button: { text: 'Mesajı yanıtla', url: `${base()}/mesajlar/${listing.id}/${senderId}` },
  });
}

function adApplied(ad) {
  const to = ad.contact_email;
  send({
    to, subject: `Reklam başvurunuz alındı (${ad.ref_code})`,
    title: 'Reklam başvurunuz alındı',
    lines: [
      `${ad.business_name} — ${konum(ad)}, ${ad.slot}. alan, ${ad.months} ay.`,
      ...odemeSatirlari(ad.price, ad.ref_code),
    ],
    button: { text: 'İşletme panelime git', url: `${base()}/isletme` },
  });
  for (const a of admins.all()) {
    send({ to: a.email, subject: `Yeni reklam başvurusu: ${ad.business_name} (${ad.ref_code})`,
      title: 'Yeni reklam başvurusu', lines: [`${ad.business_name} — ${konum(ad)}, ${ad.slot}. alan, ${ad.months} ay, ${tl(ad.price)}`],
      button: { text: 'Başvuruyu incele', url: `${base()}/yonetim?tab=bekleyen` } });
  }
}

function adApproved(ad) {
  send({
    to: ad.contact_email, subject: '🎉 Reklamınız yayında',
    title: 'Reklamınız yayına girdi',
    lines: [`${ad.business_name} reklamınız ${konum(ad)} bölgesinde ${ad.slot}. alanda yayında.`, `Bitiş tarihi: ${ad.end_date}`],
    button: { text: 'İstatistikleri gör', url: `${base()}/isletme` },
  });
}

function adRejected(ad, note) {
  send({
    to: ad.contact_email, subject: 'Reklam başvurunuz hakkında',
    title: 'Reklam başvurunuz onaylanmadı',
    lines: [`${ad.business_name} için yaptığınız başvuru onaylanmadı.`, note ? `Not: ${note}` : 'Detay için bize yanıt verebilirsiniz.'],
  });
}

function renewRequested(ad) {
  send({
    to: ad.contact_email, subject: `Süre uzatma talebiniz alındı (${ad.ref_code})`,
    title: 'Süre uzatma talebiniz alındı',
    lines: [`${ad.business_name}: +${ad.renew_months} ay`, ...odemeSatirlari(ad.renew_price, ad.ref_code)],
  });
  for (const a of admins.all()) {
    send({ to: a.email, subject: `Süre uzatma talebi: ${ad.business_name} (${ad.ref_code})`, title: 'Süre uzatma talebi',
      lines: [`+${ad.renew_months} ay, ${tl(ad.renew_price)}`], button: { text: 'Panelde aç', url: `${base()}/yonetim?tab=aktif` } });
  }
}

function renewApproved(ad) {
  send({ to: ad.contact_email, subject: 'Reklam süreniz uzatıldı', title: 'Reklam süreniz uzatıldı',
    lines: [`${ad.business_name} reklamınızın yeni bitiş tarihi: ${ad.end_date}`] });
}

// Bitişe 7 gün kalan reklamlara bir kez hatırlatma
function adReminders() {
  const rows = db.prepare(`SELECT * FROM ads WHERE status = 'active' AND reminded = 0
    AND end_date <= date('now','localtime','+7 days')`).all();
  for (const ad of rows) {
    send({
      to: ad.contact_email, subject: `⏰ Reklamınızın bitmesine ${ad.end_date} tarihine kadar süre var`,
      title: 'Reklamınızın süresi bitmek üzere',
      lines: [`${ad.business_name} (${konum(ad)}, ${ad.slot}. alan) reklamınız ${ad.end_date} tarihinde sona eriyor.`,
        'Alanınızı kaybetmemek için işletme panelinizden süreyi uzatabilirsiniz.'],
      button: { text: 'Süreyi uzat', url: `${base()}/isletme` },
    });
    db.prepare('UPDATE ads SET reminded = 1 WHERE id = ?').run(ad.id);
  }
  return rows.length;
}

function listingPending(listing, ownerId) {
  const u = userById.get(ownerId);
  if (!u) return;
  send({ to: u.email, subject: 'İlanınız incelemede', title: 'İlanınız kısa bir incelemeden sonra yayına girecek',
    lines: [`"${listing.title}" ilanınız otomatik kontrolde işaretlendi ve ekibimiz tarafından incelenecek.`] });
  for (const a of admins.all()) {
    send({ to: a.email, subject: `Onay bekleyen ilan: ${listing.title}`, title: 'Onay bekleyen ilan',
      lines: [`Yakalanan ifadeler: ${listing.mod_reason}`], button: { text: 'İncele', url: `${base()}/yonetim?tab=onay` } });
  }
}

function listingDecision(listing, approved) {
  const u = userById.get(listing.user_id);
  if (!u) return;
  send({ to: u.email, subject: approved ? 'İlanınız yayında' : 'İlanınız yayınlanmadı',
    title: approved ? 'İlanınız onaylandı ve yayında' : 'İlanınız kurallara uymadığı için yayınlanmadı',
    lines: [`"${listing.title}"`],
    button: approved ? { text: 'İlanı gör', url: `${base()}/ilan/${listing.id}` } : null });
}

module.exports = { newMessage, adApplied, adApproved, adRejected, renewRequested, renewApproved, adReminders, listingPending, listingDecision, odemeSatirlari };
