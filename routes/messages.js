const express = require('express');
const db = require('../lib/db');
const h = require('../lib/helpers');
const notify = require('../lib/notify');
const reviews = require('../lib/reviews');
const { rateLimit } = require('../lib/security');
const images = require('../lib/images');
const engel = require('../lib/engel');

const router = express.Router();

// Her konuşma = (ilan, karşı taraf) çifti
const conversations = db.prepare(`
  SELECT m.listing_id, CASE WHEN m.sender_id = :me THEN m.receiver_id ELSE m.sender_id END AS other_id,
         MAX(m.id) AS last_id,
         SUM(CASE WHEN m.receiver_id = :me AND m.read_at IS NULL THEN 1 ELSE 0 END) AS unread
  FROM messages m WHERE m.sender_id = :me OR m.receiver_id = :me
  GROUP BY m.listing_id, other_id ORDER BY last_id DESC LIMIT 100`);
const msgById = db.prepare('SELECT body, image, created_at, sender_id FROM messages WHERE id = ?');
const userName = db.prepare('SELECT id, name, created_at FROM users WHERE id = ?');
const listing = db.prepare('SELECT id, title, user_id, price, is_swap, category, image, status, il, ilce FROM listings WHERE id = ?');

router.get('/mesajlar', h.requireLogin, (req, res) => {
  const list = conversations.all({ me: req.user.id }).map((c) => ({
    ...c,
    last: msgById.get(c.last_id),
    other: userName.get(c.other_id),
    ilan: listing.get(c.listing_id),
  })).filter((c) => c.other && c.ilan);
  res.render('messages', { title: 'Mesajlar', list, noindex: true });
});

const thread = db.prepare(`SELECT * FROM messages WHERE listing_id = ?
  AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)) ORDER BY id`);
const markRead = db.prepare('UPDATE messages SET read_at = datetime(\'now\') WHERE listing_id = ? AND sender_id = ? AND receiver_id = ? AND read_at IS NULL');
const insert = db.prepare('INSERT INTO messages (listing_id, sender_id, receiver_id, body, image) VALUES (?, ?, ?, ?, ?)');

// Konuşma yalnızca ilan sahibi ile başka bir kullanıcı arasında olabilir
function loadThread(req) {
  const ilan = listing.get(parseInt(req.params.listingId, 10) || 0);
  const otherId = parseInt(req.params.userId, 10) || 0;
  if (!ilan || otherId === req.user.id) return null;
  if (ilan.user_id !== req.user.id && ilan.user_id !== otherId) return null;
  const other = userName.get(otherId);
  return other ? { ilan, other } : null;
}

router.get('/mesajlar/:listingId/:userId', h.requireLogin, (req, res, next) => {
  const t = loadThread(req);
  if (!t) return next();
  markRead.run(t.ilan.id, t.other.id, req.user.id);
  const msgs = thread.all(t.ilan.id, req.user.id, t.other.id, t.other.id, req.user.id);
  const puanlanabilir = reviews.canReview(t.ilan, req.user.id) && !reviews.existing(t.ilan.id, req.user.id);
  res.render('thread', {
    title: `${t.other.name} ile mesajlaşma`, ...t, msgs, puanlanabilir, noindex: true,
    benEngelledim: engel.engelledi(req.user.id, t.other.id), engellendim: engel.engelledi(t.other.id, req.user.id),
  });
});

router.post('/mesajlar/:listingId/:userId', h.requireLogin, h.requireVerified, rateLimit('mesaj', 60, 60), images.parse('photo', 1), h.verifyCsrf, async (req, res, next) => {
  try {
    const t = loadThread(req);
    if (!t) return next();
    const back = `/mesajlar/${t.ilan.id}/${t.other.id}#son`;
    if (engel.arasinda(req.user.id, t.other.id)) { h.flash(req, 'error', 'Bu kişiyle mesajlaşma engelli.'); return res.redirect(back); }
    if (req.uploadError) { h.flash(req, 'error', req.uploadError); return res.redirect(back); }
    const body = h.str(req.body.body, 2000);
    let image = null;
    if (req.files.length) {
      try { image = await images.saveMessagePhoto(req.files[0].buffer); } catch (e) {
        h.flash(req, 'error', 'Fotoğraf okunamadı. JPG veya PNG dene.'); return res.redirect(back);
      }
    }
    if (body || image) {
      insert.run(t.ilan.id, req.user.id, t.other.id, body, image);
      notify.newMessage({ listing: t.ilan, senderId: req.user.id, receiverId: t.other.id, body: body || '📷 Fotoğraf gönderdi' });
    }
    res.redirect(back);
  } catch (e) { next(e); }
});

// ---- Engelle / engeli kaldır ----
router.post('/engel/:userId', h.requireLogin, rateLimit('engel', 30, 60), h.verifyCsrf, (req, res, next) => {
  const other = userName.get(parseInt(req.params.userId, 10) || 0);
  if (!other || other.id === req.user.id) return next();
  if (req.body.islem === 'kaldir') {
    engel.kaldir(req.user.id, other.id);
    h.flash(req, 'success', `${other.name} için engel kaldırıldı.`);
  } else {
    engel.engelle(req.user.id, other.id);
    h.flash(req, 'success', `${other.name} engellendi. Artık birbirinize mesaj gönderemezsiniz.`);
  }
  res.redirect(h.safeNext(req.body.next) !== '/' ? h.safeNext(req.body.next) : '/mesajlar');
});

module.exports = router;
