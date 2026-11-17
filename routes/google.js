// Google ile giriş (OAuth 2.0 / OpenID Connect, ek paket kullanmadan)
const crypto = require('node:crypto');
const express = require('express');
const db = require('../lib/db');
const h = require('../lib/helpers');
const config = require('../lib/config');
const { rateLimit } = require('../lib/security');

const router = express.Router();
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

const redirectUri = (req) => `${h.baseUrl(req)}/giris/google/donus`;

router.get('/giris/google', rateLimit('google', 30, 15), (req, res) => {
  if (!config.google) { h.flash(req, 'error', 'Google ile giriş henüz ayarlanmadı.'); return res.redirect('/giris'); }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.google = { state, next: h.safeNext(req.query.next), remember: req.query.hatirla !== '0' };
  const p = new URLSearchParams({
    client_id: config.google.clientId, redirect_uri: redirectUri(req), response_type: 'code',
    scope: 'openid email profile', state, prompt: 'select_account',
  });
  res.redirect(`${AUTH_URL}?${p}`);
});

const byGoogle = db.prepare('SELECT * FROM users WHERE google_id = ?');
const byEmail = db.prepare('SELECT * FROM users WHERE email = ?');

router.get('/giris/google/donus', rateLimit('google-donus', 30, 15), async (req, res, next) => {
  const g = req.session.google;
  delete req.session.google;
  const hata = (msg) => { h.flash(req, 'error', msg); res.redirect('/giris'); };
  if (!config.google) return hata('Google ile giriş henüz ayarlanmadı.');
  if (req.query.error) return hata('Google ile giriş iptal edildi.');
  if (!g || !req.query.state || req.query.state !== g.state || !req.query.code) return hata('Google oturumu doğrulanamadı, lütfen tekrar dene.');

  let info;
  try {
    const tr = await fetch(TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: String(req.query.code), client_id: config.google.clientId, client_secret: config.google.secret,
        redirect_uri: redirectUri(req), grant_type: 'authorization_code' }),
    });
    const tok = await tr.json();
    if (!tr.ok || !tok.access_token) throw new Error(tok.error_description || tok.error || 'token alınamadı');
    const ur = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${tok.access_token}` } });
    info = await ur.json();
    if (!ur.ok || !info.sub) throw new Error('kullanıcı bilgisi alınamadı');
  } catch (e) {
    console.error('Google girişi:', e.message);
    return hata('Google ile bağlantı kurulamadı. Lütfen tekrar dene.');
  }
  if (!info.email || !info.email_verified) return hata('Google hesabının e-posta adresi doğrulanmamış.');

  try {
    const email = String(info.email).toLowerCase();
    let user = byGoogle.get(info.sub);
    let yeni = false;
    if (!user) {
      user = byEmail.get(email);
      if (user) {
        // Aynı e-postayla açılmış hesap: Google'a bağla (Google e-postayı doğruladı)
        db.prepare('UPDATE users SET google_id = ?, email_verified = 1 WHERE id = ?').run(info.sub, user.id);
      } else {
        const ad = h.str(info.name || email.split('@')[0], 80) || 'Havuç Üyesi';
        const isAdmin = (config.ADMIN_EMAIL && email === config.ADMIN_EMAIL)
          || (!config.ADMIN_EMAIL && db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n === 0) ? 1 : 0;
        const r = db.prepare("INSERT INTO users (name, email, password_hash, is_admin, email_verified, google_id) VALUES (?, ?, '!', ?, 1, ?)")
          .run(ad.length >= 3 ? ad : ad + ' Üye', email, isAdmin, info.sub);
        user = { id: Number(r.lastInsertRowid), name: ad };
        yeni = true;
      }
      user = byEmail.get(email);
    }
    if (user.banned_at) return hata('Bu hesap kurallarımızı ihlal ettiği için kalıcı olarak engellendi.');
    require('./auth').login(req, user, (err) => {
      if (err) return next(err);
      h.flash(req, 'success', yeni ? `Hoş geldin, ${user.name.split(' ')[0]}! Hesabın Google ile oluşturuldu. 🥕` : `Hoş geldin, ${user.name.split(' ')[0]}!`);
      res.redirect(g.next || '/');
    }, g.remember);
  } catch (e) { next(e); }
});

module.exports = router;
