const config = require('../config');

// Aktif ödeme sağlayıcısı: iyzico anahtarları varsa iyzico; yoksa geliştirmede test modu; canlıda kargo kapalı.
function provider() {
  if (config.iyzico) return require('./iyzico');
  if (config.KARGO_TEST) return require('./test');
  return null;
}

module.exports = { provider, kargoAcik: () => !!provider() };
