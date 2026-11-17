// Hesap silme (KVKK m.7 / m.11) ve veri dışa aktarma
const db = require('./db');
const images = require('./images');

const ACIK_SIPARIS = "('odeme_bekliyor','odendi','kargoda','itiraz')";

function engel(userId) {
  const n = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE (buyer_id = ? OR seller_id = ?) AND status IN ${ACIK_SIPARIS}`).get(userId, userId).n;
  return n ? `Devam eden ${n} siparişin var. Siparişler tamamlanınca hesabını silebilirsin.` : null;
}

/** Kişisel verileri tek bir JSON'da toplar */
function disaAktar(userId) {
  const q = (sql, ...p) => db.prepare(sql).all(...p);
  const u = db.prepare(`SELECT id, name, email, phone, email_verified, notify_email, created_at,
    CASE WHEN google_id IS NULL THEN 0 ELSE 1 END AS google_bagli FROM users WHERE id = ?`).get(userId);
  const odeme = db.prepare('SELECT first_name, last_name, phone, address, iban_last4, updated_at FROM payout_accounts WHERE user_id = ?').get(userId);
  return {
    aciklama: 'Havuç Takas hesabınıza ait kişisel veriler (KVKK m.11). IBAN ve TC kimlik numarası güvenlik nedeniyle yalnızca son haneleriyle yer alır.',
    olusturma: new Date().toISOString(),
    hesap: u,
    odeme_bilgileri: odeme || null,
    ilanlar: q(`SELECT id, title, description, category, condition, price, is_swap, il, ilce, status, views, created_at, expires_at FROM listings WHERE user_id = ?`, userId)
      .map((l) => ({ ...l, fotograflar: q('SELECT file FROM listing_images WHERE listing_id = ? ORDER BY sort', l.id).map((f) => '/uploads/' + f.file) })),
    mesajlar: q(`SELECT m.id, m.listing_id, CASE WHEN m.sender_id = ? THEN 'gönderilen' ELSE 'alınan' END AS yon,
      (SELECT name FROM users WHERE id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END) AS karsi_taraf,
      m.body, m.image, m.created_at FROM messages m WHERE m.sender_id = ? OR m.receiver_id = ? ORDER BY m.id`, userId, userId, userId, userId),
    favoriler: q('SELECT listing_id, created_at FROM favorites WHERE user_id = ?', userId),
    yaptigi_degerlendirmeler: q('SELECT listing_id, seller_id, score, comment, created_at FROM reviews WHERE reviewer_id = ?', userId),
    aldigi_degerlendirmeler: q('SELECT listing_id, score, comment, created_at FROM reviews WHERE seller_id = ?', userId),
    siparisler: q(`SELECT code, CASE WHEN buyer_id = ? THEN 'alış' ELSE 'satış' END AS tur, title, item_price, shipping_fee, service_fee, total, status,
      ship_name, ship_phone, ship_il, ship_ilce, ship_address, carrier, tracking_no, created_at FROM orders WHERE buyer_id = ? OR seller_id = ?`, userId, userId, userId),
    vitrin_odemeleri: q('SELECT code, listing_id, days, price, status, created_at FROM featured_orders WHERE user_id = ?', userId),
    reklamlar: q('SELECT business_name, il, ilce, slot, status, contact_name, contact_email, phone, created_at FROM ads WHERE user_id = ?', userId),
    kayitli_aramalar: q('SELECT q, il, ilce, kategori, tip, durum, fmin, fmax, created_at FROM saved_searches WHERE user_id = ?', userId),
    engellediklerin: q('SELECT u.name, b.created_at FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ?', userId),
    iletisim_mesajlari: q('SELECT topic, body, created_at FROM contact_messages WHERE user_id = ?', userId),
  };
}

/**
 * Hesabı siler. Yasal saklama yükümlülüğü olan sipariş/ödeme kayıtları varsa kullanıcı satırı silinmez,
 * anonimleştirilir; diğer tüm kişisel veriler silinir.
 */
function sil(userId) {
  const dosyalar = [];
  db.exec('BEGIN');
  try {
    for (const f of db.prepare('SELECT i.file, i.thumb FROM listing_images i JOIN listings l ON l.id = i.listing_id WHERE l.user_id = ?').all(userId)) dosyalar.push(f.file, f.thumb);
    for (const m of db.prepare('SELECT image FROM messages WHERE (sender_id = ? OR receiver_id = ?) AND image IS NOT NULL').all(userId, userId)) dosyalar.push(m.image);

    const kayitli = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE buyer_id = ? OR seller_id = ?').get(userId, userId).n
      + db.prepare('SELECT COUNT(*) AS n FROM featured_orders WHERE user_id = ? AND status = \'odendi\'').get(userId).n;

    db.prepare('DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?').run(userId, userId);
    // Siparişe bağlı ilanlar silinemez (kayıt), içerikleri temizlenip kaldırılır
    db.prepare(`UPDATE listings SET status = 'removed', description = '(silindi)', image = NULL
      WHERE user_id = ? AND id IN (SELECT listing_id FROM orders)`).run(userId);
    db.prepare('DELETE FROM listing_images WHERE listing_id IN (SELECT id FROM listings WHERE user_id = ? AND status = \'removed\' AND description = \'(silindi)\')').run(userId);
    db.prepare('DELETE FROM listings WHERE user_id = ? AND id NOT IN (SELECT listing_id FROM orders)').run(userId);
    for (const t of ['payout_accounts', 'favorites', 'saved_searches', 'notifications', 'tokens']) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
    db.prepare('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?').run(userId, userId);
    db.prepare('DELETE FROM reviews WHERE reviewer_id = ? OR seller_id = ?').run(userId, userId);
    db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?").run(userId);
    db.prepare('UPDATE ads SET user_id = NULL WHERE user_id = ?').run(userId);
    db.prepare('UPDATE contact_messages SET user_id = NULL WHERE user_id = ?').run(userId);

    if (kayitli) {
      db.prepare(`UPDATE users SET name = 'Silinmiş üye', email = 'silindi-' || id || '@silindi.invalid', phone = NULL, password_hash = '!',
        google_id = NULL, notify_email = 0, is_admin = 0 WHERE id = ?`).run(userId);
    } else {
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  images.remove(...dosyalar);
}

module.exports = { engel, disaAktar, sil };
