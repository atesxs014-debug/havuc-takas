// Kalıcı üye engeli: giriş yapamaz, ilanları ve reklamları yayından kalkar, aynı e-postayla yeniden kayıt olamaz
const db = require('./db');
const { send } = require('./mail');

function engelle(userId, reason) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u || u.is_admin || u.banned_at) return null;
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE users SET banned_at = datetime('now'), ban_reason = ? WHERE id = ?").run(reason || null, userId);
    const ilan = db.prepare("UPDATE listings SET status = 'banned' WHERE user_id = ? AND status IN ('active','pending','expired')").run(userId).changes;
    const reklam = db.prepare("UPDATE ads SET status = 'ended', admin_note = 'Üye engellendi' WHERE user_id = ? AND status IN ('active','pending')").run(userId).changes;
    db.prepare("UPDATE listings SET featured_until = NULL WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?").run(userId);
    db.prepare('DELETE FROM saved_searches WHERE user_id = ?').run(userId);
    db.exec('COMMIT');
    send({ to: u.email, subject: 'Hesabın engellendi', title: 'Havuç Takas hesabın kalıcı olarak engellendi',
      lines: ['Hesabın kullanım şartlarımızı ihlal ettiği için engellendi; ilanların yayından kaldırıldı.', reason ? `Neden: ${reason}` : '',
        'Bunun bir hata olduğunu düşünüyorsan iletişim sayfamızdan bize yazabilirsin.'].filter(Boolean) });
    return { ilan, reklam };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function kaldir(userId) {
  const r = db.prepare('UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE id = ? AND banned_at IS NOT NULL').run(userId);
  // İlanlar "süresi doldu" olarak döner; üye kontrol edip tek tıkla yeniden yayınlar
  if (r.changes) db.prepare("UPDATE listings SET status = 'expired' WHERE user_id = ? AND status = 'banned'").run(userId);
  return r.changes > 0;
}

module.exports = { engelle, kaldir };
