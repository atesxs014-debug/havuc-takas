const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const h = require('../lib/helpers');

const router = express.Router();

const byEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const insert = db.prepare('INSERT INTO users (name, email, phone, password_hash, is_admin) VALUES (?, ?, ?, ?, ?)');
const adminCount = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1');

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();

function login(req, user, cb) {
  req.session.regenerate((err) => {
    if (err) return cb(err);
    req.session.userId = user.id;
    cb();
  });
}

router.get('/giris', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/login', { title: 'Giriş Yap', next: h.safeNext(req.query.next), form: {} });
});

router.post('/giris', h.verifyCsrf, (req, res, next) => {
  const email = h.str(req.body.email, 200).toLowerCase();
  const user = byEmail.get(email);
  const nextUrl = h.safeNext(req.body.next);
  if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password_hash)) {
    return res.status(400).render('auth/login', { title: 'Giriş Yap', next: nextUrl, form: { email }, error: 'E-posta veya şifre hatalı.' });
  }
  login(req, user, (err) => {
    if (err) return next(err);
    h.flash(req, 'success', `Hoş geldin, ${user.name.split(' ')[0]}!`);
    res.redirect(nextUrl);
  });
});

router.get('/kayit', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/register', { title: 'Üye Ol', next: h.safeNext(req.query.next), form: {} });
});

router.post('/kayit', h.verifyCsrf, (req, res, next) => {
  const form = {
    name: h.str(req.body.name, 80),
    email: h.str(req.body.email, 200).toLowerCase(),
    phone: h.str(req.body.phone, 20),
  };
  const password = String(req.body.password || '');
  const nextUrl = h.safeNext(req.body.next);
  let error = null;
  if (form.name.length < 3) error = 'Lütfen adınızı ve soyadınızı yazın.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) error = 'Geçerli bir e-posta adresi girin.';
  else if (password.length < 8) error = 'Şifre en az 8 karakter olmalı.';
  else if (!req.body.kvkk) error = 'Devam etmek için Kullanım Şartları ve KVKK metnini onaylayın.';
  else if (byEmail.get(form.email)) error = 'Bu e-posta ile zaten bir hesap var.';
  if (error) return res.status(400).render('auth/register', { title: 'Üye Ol', next: nextUrl, form, error });

  // İlk kayıt olan kullanıcı (veya ADMIN_EMAIL) yönetici olur
  const isAdmin = (ADMIN_EMAIL && form.email === ADMIN_EMAIL) || (!ADMIN_EMAIL && adminCount.get().n === 0) ? 1 : 0;
  const info = insert.run(form.name, form.email, form.phone || null, bcrypt.hashSync(password, 10), isAdmin);
  login(req, { id: Number(info.lastInsertRowid) }, (err) => {
    if (err) return next(err);
    h.flash(req, 'success', 'Hesabın oluşturuldu. Hemen ilk ilanını verebilirsin!');
    res.redirect(nextUrl);
  });
});

router.post('/cikis', h.verifyCsrf, (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
