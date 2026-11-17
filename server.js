const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const db = require('./lib/db');
const SqliteStore = require('./lib/session-store');
const h = require('./lib/helpers');
const { kategoriler } = require('./lib/categories');
const { iller, getIl, getIlce } = require('./lib/locations');

require('node:fs').mkdirSync(h.UPLOAD_DIR, { recursive: true });

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_NAME = 'Havuç Takas';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  next();
});

app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));
app.use('/uploads', express.static(h.UPLOAD_DIR, { maxAge: '30d' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

app.use(session({
  store: new SqliteStore(),
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  name: 'havuc.sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== '0',
    maxAge: 30 * 24 * 3600 * 1000,
  },
}));

const getUser = db.prepare('SELECT id, name, email, phone, is_admin, created_at FROM users WHERE id = ?');
const unreadCount = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE receiver_id = ? AND read_at IS NULL');

app.use((req, res, next) => {
  req.user = req.session.userId ? getUser.get(req.session.userId) || null : null;
  Object.assign(res.locals, {
    SITE_NAME,
    user: req.user,
    unread: req.user ? unreadCount.get(req.user.id).n : 0,
    csrf: h.csrfToken(req),
    flash: req.session.flash || null,
    path: req.path,
    query: req.query,
    kategoriler,
    iller,
    getIl,
    getIlce,
    fiyat: h.fiyat,
    tarih: h.tarih,
    tarihSaat: h.tarihSaat,
    konumAdi: h.konumAdi,
    getKategori: h.getKategori,
    ilanUrl: h.ilanUrl,
    title: null,
    description: null,
  });
  delete req.session.flash;
  next();
});

app.use(require('./routes/public'));
app.use(require('./routes/auth'));
app.use(require('./routes/listings'));
app.use(require('./routes/messages'));
app.use(require('./routes/ads'));
app.use('/yonetim', require('./routes/admin'));

app.use((req, res) => res.status(404).render('error', { title: 'Sayfa bulunamadı', message: 'Aradığınız sayfa bulunamadı veya kaldırılmış olabilir.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Bir hata oluştu', message: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`🥕 ${SITE_NAME} çalışıyor: http://localhost:${PORT}`));
}

module.exports = app;
