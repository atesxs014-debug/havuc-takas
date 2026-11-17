const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const h = require('../lib/helpers');
const config = require('../lib/config');
const tokens = require('../lib/tokens');
const { send } = require('../lib/mail');
const { rateLimit, turnstile } = require('../lib/security');

const router = express.Router();

const byEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const byId = db.prepare('SELECT * FROM users WHERE id = ?');
const insert = db.prepare('INSERT INTO users (name, email, phone, password_hash, is_admin) VALUES (?, ?, ?, ?, ?)');
const adminCount = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1');
const setVerified = db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?');
const setPassword = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const killSessions = db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?");

const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const HATIRLA_MS = 30 * 24 * 3600 * 1000;

// remember: true → 30 gün açık kalır; false → tarayıcı kapanınca oturum biter
function login(req, user, cb, remember = true) {
  req.session.regenerate((err) => {
    if (err) return cb(err);
    req.session.userId = user.id;
    if (remember) req.session.cookie.maxAge = HATIRLA_MS;
    else req.session.cookie.expires = false;
    cb();
  });
}

function sendVerify(req, user) {
  const t = tokens.create(user.id, 'verify', 48);
  return send({
    to: user.email,
    subject: 'E-posta adresinizi doğrulayın',
    title: `Hoş geldin ${user.name.split(' ')[0]}! 🥕`,
    lines: ['Hesabını etkinleştirmek için aşağıdaki butona tıkla. Bağlantı 48 saat geçerlidir.'],
    button: { text: 'E-postamı doğrula', url: `${h.baseUrl(req)}/dogrula/${t}` },
  });
}

// ---- Giriş ----
router.get('/giris', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/login', { title: 'Giriş Yap', next: h.safeNext(req.query.next), form: {} });
});

router.post('/giris', rateLimit('giris', 10, 15), h.verifyCsrf, turnstile, (req, res, next) => {
  const email = h.str(req.body.email, 200).toLowerCase();
  const nextUrl = h.safeNext(req.body.next);
  const remember = !!req.body.remember;
  const user = req.botError ? null : byEmail.get(email);
  if (req.botError || !user || !bcrypt.compareSync(String(req.body.password || ''), user.password_hash)) {
    return res.status(400).render('auth/login', { title: 'Giriş Yap', next: nextUrl, form: { email, remember }, error: req.botError || 'E-posta veya şifre hatalı.' });
  }
  login(req, user, (err) => {
    if (err) return next(err);
    h.flash(req, 'success', `Hoş geldin, ${user.name.split(' ')[0]}!`);
    res.redirect(nextUrl);
  }, remember);
});

// ---- Kayıt ----
router.get('/kayit', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/register', { title: 'Üye Ol', next: h.safeNext(req.query.next), form: {} });
});

router.post('/kayit', rateLimit('kayit', 5, 60), h.verifyCsrf, turnstile, (req, res, next) => {
  const form = {
    name: h.str(req.body.name, 80),
    email: h.str(req.body.email, 200).toLowerCase(),
    phone: h.str(req.body.phone, 20),
  };
  const password = String(req.body.password || '');
  const nextUrl = h.safeNext(req.body.next);
  let error = req.botError || null;
  if (!error && form.name.length < 3) error = 'Lütfen adınızı ve soyadınızı yazın.';
  else if (!error && !emailOk(form.email)) error = 'Geçerli bir e-posta adresi girin.';
  else if (!error && password.length < 8) error = 'Şifre en az 8 karakter olmalı.';
  else if (!error && password !== String(req.body.password2 || '')) error = 'Şifreler birbiriyle aynı değil.';
  else if (!error && !req.body.kvkk) error = 'Devam etmek için Kullanım Şartları ve KVKK metnini onaylayın.';
  else if (!error && byEmail.get(form.email)) error = 'Bu e-posta ile zaten bir hesap var. Şifrenizi unuttuysanız sıfırlayabilirsiniz.';
  if (error) return res.status(400).render('auth/register', { title: 'Üye Ol', next: nextUrl, form, error });

  // İlk kayıt olan kullanıcı (veya ADMIN_EMAIL) yönetici olur
  const isAdmin = (config.ADMIN_EMAIL && form.email === config.ADMIN_EMAIL) || (!config.ADMIN_EMAIL && adminCount.get().n === 0) ? 1 : 0;
  const info = insert.run(form.name, form.email, form.phone || null, bcrypt.hashSync(password, 10), isAdmin);
  const user = byId.get(Number(info.lastInsertRowid));
  sendVerify(req, user);
  login(req, user, (err) => {
    if (err) return next(err);
    h.flash(req, 'success', config.REQUIRE_VERIFY
      ? `Hesabın oluşturuldu! ${user.email} adresine gönderdiğimiz bağlantıyla e-postanı doğrula.`
      : 'Hesabın oluşturuldu. Hemen ilk ilanını verebilirsin!');
    res.redirect(nextUrl);
  });
});

router.post('/cikis', h.verifyCsrf, (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---- E-posta doğrulama ----
router.get('/dogrula/:token', (req, res) => {
  const uid = tokens.consume(req.params.token, 'verify');
  if (!uid) return res.status(400).render('error', { title: 'Bağlantı geçersiz', message: 'Doğrulama bağlantısı geçersiz veya süresi dolmuş. Hesabım sayfasından yeni bağlantı isteyebilirsin.' });
  setVerified.run(uid);
  h.flash(req, 'success', 'E-posta adresin doğrulandı. Teşekkürler! ✅');
  res.redirect(req.user ? '/hesabim' : '/giris');
});

router.post('/dogrula/tekrar', h.requireLogin, rateLimit('dogrula', 3, 60), h.verifyCsrf, async (req, res) => {
  if (!req.user.email_verified) await sendVerify(req, req.user);
  h.flash(req, 'success', 'Doğrulama bağlantısı tekrar gönderildi. Spam klasörünü de kontrol et.');
  res.redirect(h.safeNext(req.body.next || '/hesabim'));
});

// ---- Şifremi unuttum ----
router.get('/sifremi-unuttum', (req, res) => res.render('auth/forgot', { title: 'Şifremi Unuttum', form: {} }));

router.post('/sifremi-unuttum', rateLimit('sifre', 5, 60), h.verifyCsrf, turnstile, (req, res) => {
  const email = h.str(req.body.email, 200).toLowerCase();
  if (req.botError) return res.status(400).render('auth/forgot', { title: 'Şifremi Unuttum', form: { email }, error: req.botError });
  const user = byEmail.get(email);
  if (user) {
    const t = tokens.create(user.id, 'reset', 1);
    send({
      to: user.email, subject: 'Şifre sıfırlama', title: 'Şifreni sıfırla',
      lines: ['Şifreni sıfırlamak için aşağıdaki butona tıkla. Bağlantı 1 saat geçerlidir.', 'Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.'],
      button: { text: 'Yeni şifre belirle', url: `${h.baseUrl(req)}/sifre-sifirla/${t}` },
    });
  }
  // Hesabın var olup olmadığını belli etme
  res.render('auth/forgot', { title: 'Şifremi Unuttum', form: {}, sent: true });
});

router.get('/sifre-sifirla/:token', (req, res) => {
  if (!tokens.peek(req.params.token, 'reset')) {
    return res.status(400).render('error', { title: 'Bağlantı geçersiz', message: 'Şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş. Lütfen yeniden isteyin.' });
  }
  res.render('auth/reset', { title: 'Yeni Şifre', token: req.params.token });
});

router.post('/sifre-sifirla/:token', rateLimit('sifre', 5, 60), h.verifyCsrf, (req, res, next) => {
  const password = String(req.body.password || '');
  if (password.length < 8) return res.status(400).render('auth/reset', { title: 'Yeni Şifre', token: req.params.token, error: 'Şifre en az 8 karakter olmalı.' });
  if (password !== String(req.body.password2 || '')) return res.status(400).render('auth/reset', { title: 'Yeni Şifre', token: req.params.token, error: 'Şifreler birbiriyle aynı değil.' });
  const uid = tokens.consume(req.params.token, 'reset');
  if (!uid) return res.status(400).render('error', { title: 'Bağlantı geçersiz', message: 'Bağlantının süresi dolmuş. Lütfen yeniden isteyin.' });
  setPassword.run(bcrypt.hashSync(password, 10), uid);
  setVerified.run(uid); // e-postaya erişebildiği kanıtlandı
  killSessions.run(uid); // diğer cihazlardaki oturumları kapat
  login(req, { id: uid }, (err) => {
    if (err) return next(err);
    h.flash(req, 'success', 'Şifren güncellendi.');
    res.redirect('/hesabim');
  });
});

// ---- Hesap ayarları ----
router.get('/hesabim/ayarlar', h.requireLogin, (req, res) => res.render('auth/settings', { title: 'Hesap Ayarları' }));

router.post('/hesabim/ayarlar', h.requireLogin, h.verifyCsrf, (req, res) => {
  const name = h.str(req.body.name, 80);
  const phone = h.str(req.body.phone, 20);
  if (name.length < 3) { h.flash(req, 'error', 'Ad soyad en az 3 karakter olmalı.'); return res.redirect('/hesabim/ayarlar'); }
  db.prepare('UPDATE users SET name = ?, phone = ?, notify_email = ? WHERE id = ?').run(name, phone || null, req.body.notify_email ? 1 : 0, req.user.id);
  const yeni = String(req.body.new_password || '');
  if (yeni) {
    const u = byId.get(req.user.id);
    if (!bcrypt.compareSync(String(req.body.password || ''), u.password_hash)) { h.flash(req, 'error', 'Mevcut şifre hatalı, şifre değiştirilmedi.'); return res.redirect('/hesabim/ayarlar'); }
    if (yeni.length < 8) { h.flash(req, 'error', 'Yeni şifre en az 8 karakter olmalı.'); return res.redirect('/hesabim/ayarlar'); }
    if (yeni !== String(req.body.new_password2 || '')) { h.flash(req, 'error', 'Yeni şifreler birbiriyle aynı değil, şifre değiştirilmedi.'); return res.redirect('/hesabim/ayarlar'); }
    setPassword.run(bcrypt.hashSync(yeni, 10), req.user.id);
  }
  h.flash(req, 'success', 'Ayarların kaydedildi.');
  res.redirect('/hesabim/ayarlar');
});

module.exports = router;
