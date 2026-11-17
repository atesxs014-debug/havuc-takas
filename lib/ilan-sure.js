// İlan süresi: 30 gün yayında kalır, bitmeden 3 gün önce sahibine yenileme e-postası, süre dolunca "expired"
const db = require('./db');
const config = require('./config');
const { send } = require('./mail');
const bildirim = require('./bildirim');

const HATIRLATMA_GUN = 3;
const base = () => config.SITE_URL || `http://localhost:${config.PORT}`;

function kontrol() {
  // 1) Yakında bitecekler: bir kez hatırlat
  const yakin = db.prepare(`SELECT l.id, l.title, l.expires_at, u.id AS uid, u.email, u.name FROM listings l JOIN users u ON u.id = l.user_id
    WHERE l.status = 'active' AND l.expiry_reminded = 0 AND l.expires_at <= datetime('now', '+${HATIRLATMA_GUN} days')`).all();
  for (const l of yakin) {
    send({
      to: l.email, subject: `⌛ "${l.title}" ilanının süresi bitiyor`,
      title: 'İlanının süresi bitmek üzere',
      lines: [`"${l.title}" ilanın ${HATIRLATMA_GUN} gün içinde yayından kalkacak.`, 'Ürün hâlâ duruyorsa tek tıkla 30 gün daha yayında tutabilirsin. Sattıysan bir şey yapmana gerek yok.'],
      button: { text: '30 gün yenile', url: `${base()}/ilan/${l.id}/yenile` },
    });
    bildirim.ekle(l.uid, `"${l.title}" ilanının süresi ${HATIRLATMA_GUN} gün içinde bitiyor`, `/ilan/${l.id}/yenile`, '⌛');
    db.prepare('UPDATE listings SET expiry_reminded = 1 WHERE id = ?').run(l.id);
  }
  // 2) Süresi dolanlar
  const dolan = db.prepare(`SELECT id, user_id, title FROM listings WHERE status = 'active' AND expires_at <= datetime('now')`).all();
  for (const l of dolan) {
    db.prepare("UPDATE listings SET status = 'expired' WHERE id = ?").run(l.id);
    bildirim.ekle(l.user_id, `"${l.title}" ilanının süresi doldu. Yenilemek için dokun.`, `/ilan/${l.id}/yenile`, '⌛');
  }
  return { hatirlatilan: yakin.length, dolan: dolan.length };
}

module.exports = { kontrol, HATIRLATMA_GUN };
