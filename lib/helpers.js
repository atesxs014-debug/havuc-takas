const crypto = require('node:crypto');
const path = require('node:path');
const { konumAdi } = require('./locations');
const { getKategori } = require('./categories');

const { UPLOAD_DIR } = require('./images');

const fiyat = (n) => (n == null ? '' : new Intl.NumberFormat('tr-TR').format(n) + ' TL');

function tarih(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + (s.length > 10 ? 'Z' : ''));
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Istanbul' });
}

function tarihSaat(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
}

function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  return req.session.csrf;
}

function verifyCsrf(req, res, next) {
  const t = req.body && req.body._csrf;
  if (!t || !req.session.csrf || t.length !== req.session.csrf.length ||
      !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(req.session.csrf))) {
    return res.status(403).render('error', { title: 'Oturum süresi doldu', message: 'Güvenlik doğrulaması başarısız. Sayfayı yenileyip tekrar deneyin.' });
  }
  next();
}

function flash(req, type, text) {
  req.session.flash = { type, text };
}

function requireLogin(req, res, next) {
  if (!req.user) {
    flash(req, 'info', 'Devam etmek için giriş yapın.');
    return res.redirect('/giris?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

// E-posta doğrulaması zorunluysa ilan verme / mesaj gönderme öncesi kontrol
function requireVerified(req, res, next) {
  if (!require('./config').REQUIRE_VERIFY || (req.user && req.user.email_verified)) return next();
  res.status(403).render('verify-needed', { title: 'E-postanı doğrula' });
}

function baseUrl(req) {
  return require('./config').SITE_URL || `${req.protocol}://${req.get('host')}`;
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) return res.status(404).render('error', { title: 'Sayfa bulunamadı', message: 'Aradığınız sayfa bulunamadı.' });
  next();
}

// Yalnızca site içi yönlendirmeye izin ver
const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/');

const str = (v, max = 1000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

module.exports = {
  fiyat, tarih, tarihSaat, csrfToken, verifyCsrf, flash,
  requireLogin, requireVerified, baseUrl, requireAdmin, safeNext, str, konumAdi, getKategori, UPLOAD_DIR,
};

const TR = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', İ: 'i', I: 'i', Ö: 'o', Ş: 's', Ü: 'u' };
function slugify(s) {
  return String(s).replace(/[çğıöşüÇĞİIÖŞÜ]/g, (c) => TR[c]).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
const ilanUrl = (l) => `/ilan/${l.id}-${slugify(l.title)}`;
module.exports.slugify = slugify;
module.exports.ilanUrl = ilanUrl;
