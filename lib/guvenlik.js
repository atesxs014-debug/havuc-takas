// Güvenlik: HTTP başlıkları (CSP, HSTS), hesap kilidi, yeni cihazdan giriş uyarısı
const crypto = require('node:crypto');
const db = require('./db');
const config = require('./config');
const { send } = require('./mail');

// ---- HTTP güvenlik başlıkları ----
const origin = (u) => { try { return new URL(u).origin; } catch { return null; } };

function csp({ odeme = false } = {}) {
  const a = config.analytics;
  const analitik = [a.umamiSrc && a.umamiId ? origin(a.umamiSrc) : null, a.plausibleDomain ? origin(a.plausibleSrc) : null].filter(Boolean);
  const turnstile = config.turnstile ? ['https://challenges.cloudflare.com'] : [];
  // iyzico ödeme formu kendi satır içi betiğini ve çerçevesini kullanır; yalnızca ödeme sayfalarında izin verilir
  const iyzico = odeme ? ['https://*.iyzipay.com', 'https://*.iyzico.com'] : [];
  const d = {
    'default-src': ["'self'"],
    'script-src': ["'self'", ...turnstile, ...analitik, ...iyzico, ...(odeme ? ["'unsafe-inline'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'", ...iyzico],
    'img-src': ["'self'", 'data:', 'blob:', ...iyzico],
    'font-src': ["'self'", 'data:', ...iyzico],
    'connect-src': ["'self'", ...analitik, ...turnstile, ...iyzico],
    'frame-src': [...turnstile, ...iyzico].length ? [...turnstile, ...iyzico] : ["'none'"],
    'form-action': ["'self'", 'https://*.iyzipay.com'],
    'frame-ancestors': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
  };
  if (config.PROD) d['upgrade-insecure-requests'] = [];
  return Object.entries(d).map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k)).join('; ');
}

const CSP_NORMAL = () => csp();
const CSP_ODEME = () => csp({ odeme: true });
const ODEME_YOLU = /^\/(siparis|vitrin)\/[^/]+\/odeme$/;

function basliklar(req, res, next) {
  res.set({
    'Content-Security-Policy': ODEME_YOLU.test(req.path) ? CSP_ODEME() : CSP_NORMAL(),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(self "https://*.iyzipay.com")',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  // HSTS yalnızca HTTPS üzerinden ve canlıda (yerelde http://localhost bozulmasın)
  if (config.PROD && req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

// ---- Hesap kilidi: 5 yanlış şifrede 15 dakika ----
const KILIT_DENEME = 5;
const KILIT_DK = 15;

/** Hesap kilitliyse kalan dakikayı döndürür */
function kilitli(user) {
  if (!user.locked_until) return 0;
  const kalan = new Date(user.locked_until.replace(' ', 'T') + 'Z') - Date.now();
  return kalan > 0 ? Math.ceil(kalan / 60000) : 0;
}

/** Yanlış şifre: sayacı artır, sınır aşılınca kilitle ve sahibine haber ver. Kilitlendiyse true döner. */
function yanlisSifre(user, req) {
  const n = (user.failed_logins || 0) + 1;
  if (n >= KILIT_DENEME) {
    db.prepare(`UPDATE users SET failed_logins = 0, locked_until = datetime('now', '+${KILIT_DK} minutes') WHERE id = ?`).run(user.id);
    send({
      to: user.email, subject: '🔒 Hesabın geçici olarak kilitlendi',
      title: 'Hesabına çok sayıda hatalı giriş denemesi yapıldı',
      lines: [`Art arda ${KILIT_DENEME} yanlış şifre girildiği için hesabın ${KILIT_DK} dakika kilitlendi.`, `IP adresi: ${req.ip}`,
        'Bu sen değilsen şifreni değiştirmeni öneririz.'],
      button: { text: 'Şifremi sıfırla', url: `${config.SITE_URL || `${req.protocol}://${req.get('host')}`}/sifremi-unuttum` },
    });
    return true;
  }
  db.prepare('UPDATE users SET failed_logins = ? WHERE id = ?').run(n, user.id);
  return false;
}

function basarili(userId) {
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(userId);
}

// ---- Yeni cihazdan giriş uyarısı ----
const CEREZ = 'havuc.cihaz';
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const cerezOku = (req) => {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)havuc\.cihaz=([A-Za-z0-9_-]{20,64})/);
  return m ? m[1] : null;
};

function tarayiciAdi(ua = '') {
  const t = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Tarayıcı';
  const s = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'bilinmeyen sistem';
  return `${t} · ${s}`;
}

/** Girişten sonra çağrılır: cihaz tanınmıyorsa (ve bu ilk cihaz değilse) e-posta ile uyarır */
function cihazKontrol(req, res, user) {
  let id = cerezOku(req);
  if (!id) {
    id = crypto.randomBytes(24).toString('base64url');
    res.cookie(CEREZ, id, { httpOnly: true, sameSite: 'lax', secure: config.PROD && req.secure, maxAge: 2 * 365 * 86400000 });
  }
  const h = hash(id);
  const ua = String(req.get('user-agent') || '').slice(0, 300);
  const bilinen = db.prepare('SELECT 1 FROM known_devices WHERE user_id = ? AND device_hash = ?').get(user.id, h);
  if (bilinen) {
    db.prepare("UPDATE known_devices SET last_seen = datetime('now') WHERE user_id = ? AND device_hash = ?").run(user.id, h);
    return false;
  }
  const ilk = db.prepare('SELECT COUNT(*) AS n FROM known_devices WHERE user_id = ?').get(user.id).n === 0;
  db.prepare('INSERT OR IGNORE INTO known_devices (user_id, device_hash, user_agent) VALUES (?, ?, ?)').run(user.id, h, ua);
  if (ilk) return false;
  const zaman = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'long', timeStyle: 'short' });
  send({
    to: user.email, subject: '🔐 Hesabına yeni bir cihazdan giriş yapıldı',
    title: 'Yeni cihazdan giriş',
    lines: [`Zaman: ${zaman}`, `Cihaz: ${tarayiciAdi(ua)}`, `IP adresi: ${req.ip}`,
      'Bu sensen bir şey yapmana gerek yok. Sen değilsen hemen şifreni değiştir.'],
    button: { text: 'Şifremi değiştir', url: `${config.SITE_URL || `${req.protocol}://${req.get('host')}`}/sifremi-unuttum` },
  });
  require('./bildirim').ekle(user.id, `Hesabına yeni bir cihazdan giriş yapıldı (${tarayiciAdi(ua)})`, '/hesabim/ayarlar', '🔐');
  return true;
}

module.exports = { basliklar, csp, kilitli, yanlisSifre, basarili, cihazKontrol, tarayiciAdi, KILIT_DENEME, KILIT_DK };
