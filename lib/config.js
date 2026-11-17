// Tüm ayarlar tek yerde. Değerler .env dosyasından veya ortam değişkenlerinden okunur.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const env = process.env;
const DATA_DIR = path.dirname(env.DB_PATH || path.join(__dirname, '..', 'data', 'havuc.db'));
fs.mkdirSync(DATA_DIR, { recursive: true });

// SESSION_SECRET verilmezse bir kez üretilip saklanır (kendi bilgisayarında kurulum kolay olsun diye)
function sessionSecret() {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  const f = path.join(DATA_DIR, '.session-secret');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch {}
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}

const smtpOn = !!env.SMTP_HOST;

module.exports = {
  PORT: parseInt(env.PORT, 10) || 3000,
  PROD: env.NODE_ENV === 'production',
  DATA_DIR,
  SITE_URL: (env.SITE_URL || '').replace(/\/+$/, ''),
  SESSION_SECRET: sessionSecret(),
  ADMIN_EMAIL: (env.ADMIN_EMAIL || '').toLowerCase().trim(),

  smtp: smtpOn ? {
    host: env.SMTP_HOST,
    port: parseInt(env.SMTP_PORT, 10) || 587,
    secure: env.SMTP_SECURE === '1' || env.SMTP_PORT === '465',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  } : null,
  MAIL_FROM: env.MAIL_FROM || 'Havuç Takas <no-reply@havuctakas.local>',
  // SMTP tanımlıysa e-posta doğrulaması zorunlu; değilse e-postalar konsola/dosyaya yazılır
  REQUIRE_VERIFY: env.REQUIRE_EMAIL_VERIFICATION ? env.REQUIRE_EMAIL_VERIFICATION === '1' : smtpOn,

  turnstile: env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY
    ? { siteKey: env.TURNSTILE_SITE_KEY, secret: env.TURNSTILE_SECRET_KEY } : null,

  analytics: {
    umamiSrc: env.UMAMI_SCRIPT_URL || '',
    umamiId: env.UMAMI_WEBSITE_ID || '',
    plausibleDomain: env.PLAUSIBLE_DOMAIN || '',
    plausibleSrc: env.PLAUSIBLE_SCRIPT_URL || 'https://plausible.io/js/script.js',
  },

  // Güvenli ödemeli kargo. iyzico anahtarları varsa iyzico Pazaryeri, yoksa (yalnızca geliştirmede) test modu.
  iyzico: env.IYZICO_API_KEY && env.IYZICO_SECRET_KEY ? {
    apiKey: env.IYZICO_API_KEY,
    secretKey: env.IYZICO_SECRET_KEY,
    uri: env.IYZICO_URI || 'https://sandbox-api.iyzipay.com',
  } : null,
  KARGO_TEST: env.KARGO_TEST_MODE ? env.KARGO_TEST_MODE === '1' : env.NODE_ENV !== 'production',

  bank: {
    iban: env.BANK_IBAN || '',
    holder: env.BANK_HOLDER || '',
    name: env.BANK_NAME || '',
  },

  backup: {
    dir: env.BACKUP_DIR || path.join(DATA_DIR, 'yedekler'),
    keepDays: parseInt(env.BACKUP_KEEP_DAYS, 10) || 14,
    enabled: env.BACKUP_DISABLED !== '1',
  },
};
