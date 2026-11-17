// Test ödeme sağlayıcısı: gerçek para hareketi yok. Kendi bilgisayarında akışı denemek içindir.
const crypto = require('node:crypto');

module.exports = {
  name: 'test',
  live: false,
  async registerSeller() {
    return { subMerchantKey: 'test-' + crypto.randomBytes(6).toString('hex') };
  },
  async startCheckout(order) {
    const token = 'test-' + crypto.randomBytes(16).toString('hex');
    return { token, redirect: `/siparis/${order.code}/test-odeme` };
  },
  // Platformun kendi ürünü (vitrin): satıcıya aktarım yok
  async startPlatformCheckout(fo) {
    const token = 'test-' + crypto.randomBytes(16).toString('hex');
    return { token, redirect: `/vitrin/${fo.code}/test-odeme` };
  },
  async finishPlatformCheckout() {
    return { ok: true, paymentId: 'TV' + Date.now() };
  },
  async finishCheckout(token) {
    return { ok: true, paymentId: 'TP' + Date.now(), txIds: [{ id: 'T1-' + token.slice(-6) }, { id: 'T2-' + token.slice(-6) }] };
  },
  async release() { return { ok: true }; },
  async refund() { return { ok: true }; },
};
