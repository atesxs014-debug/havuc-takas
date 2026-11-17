// Favorideki ilanın fiyatı düşünce favoriye ekleyenlere zil + e-posta
const db = require('./db');
const config = require('./config');
const { send } = require('./mail');
const bildirim = require('./bildirim');
const h = require('./helpers');

const base = () => config.SITE_URL || `http://localhost:${config.PORT}`;
const tl = (n) => new Intl.NumberFormat('tr-TR').format(n) + ' TL';
const favoriler = db.prepare(`SELECT u.id, u.email, u.notify_email FROM favorites f JOIN users u ON u.id = f.user_id
  WHERE f.listing_id = ? AND u.id != ? AND u.banned_at IS NULL`);

function bildir(l, yeniFiyat) {
  const url = h.ilanUrl({ id: l.id, title: l.title });
  const yuzde = Math.round((1 - yeniFiyat / l.price) * 100);
  for (const u of favoriler.all(l.id, l.user_id)) {
    bildirim.ekle(u.id, `Favorindeki "${l.title}" ilanının fiyatı düştü: ${tl(l.price)} → ${tl(yeniFiyat)}`, url, '📉');
    if (!u.notify_email) continue;
    send({
      to: u.email, subject: `📉 Fiyatı düştü: ${l.title}`, title: 'Favorindeki ilanın fiyatı düştü',
      lines: [`"${l.title}" ilanının fiyatı ${tl(l.price)} iken ${tl(yeniFiyat)} oldu (%${yuzde} indirim).`],
      button: { text: 'İlana git', url: base() + url },
    });
  }
}

module.exports = { bildir };
