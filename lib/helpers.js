const crypto = require('node:crypto');
const path = require('node:path');
const multer = require('multer');
const { konumAdi } = require('./locations');
const { getKategori } = require('./categories');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype];
      cb(null, crypto.randomBytes(12).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Sadece JPG, PNG veya WEBP görsel yükleyebilirsiniz.'));
  },
});

// Multer hatalarını sayfayı çökertmeden flash mesajına çevir
function uploadSingle(field) {
  return (req, res, next) =>
    upload.single(field)(req, res, (err) => {
      if (err) {
        req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'Görsel en fazla 5 MB olabilir.' : err.message;
      }
      next();
    });
}

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
    if (req.file) require('node:fs').unlink(req.file.path, () => {});
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

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) return res.status(404).render('error', { title: 'Sayfa bulunamadı', message: 'Aradığınız sayfa bulunamadı.' });
  next();
}

// Yalnızca site içi yönlendirmeye izin ver
const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/');

const str = (v, max = 1000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

module.exports = {
  upload, uploadSingle, fiyat, tarih, tarihSaat, csrfToken, verifyCsrf, flash,
  requireLogin, requireAdmin, safeNext, str, konumAdi, getKategori, UPLOAD_DIR,
};

const TR = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', İ: 'i', I: 'i', Ö: 'o', Ş: 's', Ü: 'u' };
function slugify(s) {
  return String(s).replace(/[çğıöşüÇĞİIÖŞÜ]/g, (c) => TR[c]).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
const ilanUrl = (l) => `/ilan/${l.id}-${slugify(l.title)}`;
module.exports.slugify = slugify;
module.exports.ilanUrl = ilanUrl;
