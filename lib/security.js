// Deneme sınırı (rate limit) ve Cloudflare Turnstile bot doğrulaması
const config = require('./config');

const buckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60000).unref();

/**
 * rateLimit('giris', 10, 15) → aynı IP'den 15 dakikada en fazla 10 deneme
 */
function rateLimit(name, max, minutes) {
  const windowMs = minutes * 60000;
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
    b.n++;
    if (b.n > max) {
      const dk = Math.ceil((b.reset - now) / 60000);
      res.set('Retry-After', String(Math.ceil((b.reset - now) / 1000)));
      return res.status(429).render('error', {
        title: 'Çok fazla deneme',
        message: `Kısa sürede çok fazla istek gönderdiniz. Lütfen ${dk} dakika sonra tekrar deneyin.`,
      });
    }
    next();
  };
}

/** Turnstile anahtarları tanımlıysa formdaki doğrulamayı kontrol eder */
function turnstile(req, res, next) {
  if (!config.turnstile) return next();
  const token = req.body && req.body['cf-turnstile-response'];
  const fail = () => {
    req.botError = 'Robot olmadığınızı doğrulayın ve tekrar deneyin.';
    next();
  };
  if (!token) return fail();
  const body = new URLSearchParams({ secret: config.turnstile.secret, response: token, remoteip: req.ip });
  fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(8000) })
    .then((r) => r.json())
    .then((d) => (d.success ? next() : fail()))
    .catch(() => fail());
}

module.exports = { rateLimit, turnstile };
