const path = require('node:path');
const express = require('express');
const session = require('express-session');
const config = require('./lib/config');
const db = require('./lib/db');
const SqliteStore = require('./lib/session-store');
const h = require('./lib/helpers');
const { UPLOAD_DIR } = require('./lib/images');
const { kategoriler } = require('./lib/categories');
const { iller, getIl, getIlce } = require('./lib/locations');

const app = express();
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
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});

// PWA: service worker kök dizinden sunulmalı
app.get('/sw.js', (req, res) => {
  res.set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});
app.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json').sendFile(path.join(__dirname, 'public', 'manifest.webmanifest'));
});
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

app.use(session({
  store: new SqliteStore(),
  secret: config.SESSION_SECRET,
  name: 'havuc.sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.PROD && process.env.COOKIE_SECURE !== '0',
  },
}));

const getUser = db.prepare('SELECT id, name, email, phone, is_admin, email_verified, notify_email, created_at FROM users WHERE id = ?');
const unreadCount = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE receiver_id = ? AND read_at IS NULL');
const favIds = db.prepare('SELECT listing_id FROM favorites WHERE user_id = ?');

app.use((req, res, next) => {
  req.user = req.session.userId ? getUser.get(req.session.userId) || null : null;
  const base = h.baseUrl(req);
  Object.assign(res.locals, {
    SITE_NAME,
    user: req.user,
    unread: req.user ? unreadCount.get(req.user.id).n : 0,
    favs: req.user ? new Set(favIds.all(req.user.id).map((r) => r.listing_id)) : new Set(),
    csrf: h.csrfToken(req),
    flash: req.session.flash || null,
    path: req.path,
    query: req.query,
    base,
    canonical: base + req.path,
    ogImage: base + '/static/img/og.png',
    ogType: 'website',
    jsonLd: null,
    noindex: false,
    cfg: {
      turnstileKey: config.turnstile ? config.turnstile.siteKey : '',
      analytics: config.analytics,
      requireVerify: config.REQUIRE_VERIFY,
    },
    kategoriler, iller, getIl, getIlce,
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

app.use(require('./routes/seo'));
app.use(require('./routes/public'));
app.use(require('./routes/auth'));
app.use(require('./routes/listings'));
app.use(require('./routes/social'));
app.use(require('./routes/orders'));
app.use(require('./routes/messages'));
app.use(require('./routes/ads'));
app.use(require('./routes/business'));
app.use('/yonetim', require('./routes/admin'));

app.use((req, res) => res.status(404).render('error', { title: 'Sayfa bulunamadı', message: 'Aradığınız sayfa bulunamadı veya kaldırılmış olabilir.', noindex: true }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Bir hata oluştu', message: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.', noindex: true });
});

if (require.main === module) {
  require('./lib/jobs').start();
  app.listen(config.PORT, () => {
    console.log(`\n🥕 ${SITE_NAME} çalışıyor: http://localhost:${config.PORT}`);
    if (!config.smtp) console.log('ℹ️  SMTP ayarlı değil: e-postalar bu pencereye ve data/epostalar klasörüne yazılacak.');
    if (!config.turnstile) console.log('ℹ️  Turnstile anahtarı yok: bot doğrulaması kapalı (deneme sınırı açık).');
    console.log('   Durdurmak için Ctrl+C\n');
  });
}

module.exports = app;
