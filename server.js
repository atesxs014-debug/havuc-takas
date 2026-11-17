const path = require('node:path');
const fs = require('node:fs');
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

app.use(require('./lib/guvenlik').basliklar);

// PWA: service worker kök dizinden sunulmalı
// CSS/JS adresine içerikten üretilen sürüm eklenir: dosya değişince tarayıcı ve service worker eskisini kullanmaz
const ASSET_V = require('node:crypto').createHash('sha1')
  .update(fs.readFileSync(path.join(__dirname, 'public', 'css', 'style.css')))
  .update(fs.readFileSync(path.join(__dirname, 'public', 'js', 'app.js')))
  .update(fs.readFileSync(path.join(__dirname, 'public', 'sw.js')))
  .update(fs.readFileSync(path.join(__dirname, 'public', 'css', 'admin.css')))
  .update(fs.readFileSync(path.join(__dirname, 'public', 'js', 'admin.js'))).digest('hex').slice(0, 10);
app.locals.assetV = ASSET_V;
const SW = fs.readFileSync(path.join(__dirname, 'public', 'sw.js'), 'utf8').replace(/__V__/g, ASSET_V);
app.get('/sw.js', (req, res) => {
  res.set({ 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-cache' });
  res.type('application/javascript').send(SW);
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

const getUser = db.prepare('SELECT id, name, email, phone, is_admin, email_verified, notify_email, created_at, google_id, banned_at, password_hash = \'!\' AS no_password FROM users WHERE id = ?');
const unreadCount = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE receiver_id = ? AND read_at IS NULL');
const favIds = db.prepare('SELECT listing_id FROM favorites WHERE user_id = ?');
const teklifSayisi = db.prepare(`SELECT (SELECT COUNT(*) FROM offers o JOIN listings l ON l.id = o.listing_id WHERE o.seller_id = :u AND o.status = 'bekliyor' AND l.status = 'active')
  + (SELECT COUNT(*) FROM offers o JOIN listings l ON l.id = o.listing_id WHERE o.buyer_id = :u AND o.status = 'karsi' AND l.status = 'active') AS n`);

app.use((req, res, next) => {
  req.user = req.session.userId ? getUser.get(req.session.userId) || null : null;
  // Engellenen üyenin oturumu kapanır
  if (req.user && req.user.banned_at) { req.user = null; delete req.session.userId; }
  const base = h.baseUrl(req);
  Object.assign(res.locals, {
    SITE_NAME,
    user: req.user,
    unread: req.user ? unreadCount.get(req.user.id).n : 0,
    bildirimSayisi: req.user ? require('./lib/bildirim').okunmamis(req.user.id) : 0,
    teklifSayisi: req.user ? teklifSayisi.get({ u: req.user.id }).n : 0,
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
      google: !!config.google,
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
app.use(require('./routes/hesap'));
app.use(require('./routes/google'));
app.use(require('./routes/canli'));
app.use(require('./routes/teklif'));
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
