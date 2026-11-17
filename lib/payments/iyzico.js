// iyzico Pazaryeri entegrasyonu
// Akış: satıcı alt üye işyeri (sub merchant) olarak kaydedilir → alıcı iyzico ödeme formuyla öder →
// para iyzico'da bekler → alıcı "teslim aldım" deyince (veya otomatik) kalemler onaylanır (approval) ve
// satıcının IBAN'ına aktarılır. Sorun olursa kalemler iade edilir (refund).
const Iyzipay = require('iyzipay');
const config = require('../config');

const client = () => new Iyzipay(config.iyzico);
const call = (resource, method, req) => new Promise((resolve, reject) => {
  client()[resource][method](req, (err, res) => (err ? reject(err) : resolve(res)));
});
const tl = (n) => Number(n).toFixed(2);
const fail = (res) => new Error(`iyzico: ${res && (res.errorMessage || res.errorCode) || 'bilinmeyen hata'}`);

module.exports = {
  name: 'iyzico',
  live: true,

  async registerSeller(user, acc) {
    const req = {
      locale: 'tr',
      conversationId: `seller-${user.id}`,
      subMerchantExternalId: `HVC-U${user.id}`,
      subMerchantType: Iyzipay.SUB_MERCHANT_TYPE.PERSONAL,
      address: acc.address,
      contactName: acc.first_name,
      contactSurname: acc.last_name,
      email: user.email,
      gsmNumber: acc.phoneE164,
      name: `${acc.first_name} ${acc.last_name}`,
      iban: acc.iban,
      identityNumber: acc.tckn,
      currency: Iyzipay.CURRENCY.TRY,
    };
    if (acc.sub_merchant_key) {
      const res = await call('subMerchant', 'update', { ...req, subMerchantKey: acc.sub_merchant_key });
      if (res.status !== 'success') throw fail(res);
      return { subMerchantKey: acc.sub_merchant_key };
    }
    const res = await call('subMerchant', 'create', req);
    if (res.status !== 'success') throw fail(res);
    return { subMerchantKey: res.subMerchantKey };
  },

  // Sepet: ürün (satıcıya ürün bedeli) + kargo (satıcıya kargo ücreti). Komisyon/hizmet bedeli yok: tutarın tamamı satıcıya.
  async startCheckout(order, { buyer, ip, callbackUrl, subMerchantKey, ilAdi }) {
    const [ad, ...soyad] = order.ship_name.split(' ');
    const address = { contactName: order.ship_name, city: ilAdi, country: 'Turkey', address: order.ship_address };
    const req = {
      locale: 'tr',
      conversationId: order.code,
      price: tl(order.total),
      paidPrice: tl(order.total),
      currency: Iyzipay.CURRENCY.TRY,
      basketId: order.code,
      paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
      callbackUrl,
      enabledInstallments: [1],
      buyer: {
        id: `U${buyer.id}`,
        name: ad,
        surname: soyad.join(' ') || ad,
        gsmNumber: order.ship_phone,
        email: buyer.email,
        // Alan zorunlu ama alıcıdan TC kimlik no istemiyoruz. Canlıya almadan önce bu kullanımı iyzico ile teyit edin.
        identityNumber: '11111111111',
        registrationAddress: order.ship_address,
        ip,
        city: ilAdi,
        country: 'Turkey',
      },
      shippingAddress: address,
      billingAddress: address,
      basketItems: [
        { id: `L${order.listing_id}`, name: order.title.slice(0, 100), category1: 'İkinci El', itemType: Iyzipay.BASKET_ITEM_TYPE.PHYSICAL,
          price: tl(order.item_price), subMerchantKey, subMerchantPrice: tl(order.item_price) },
        ...(order.shipping_fee > 0 ? [{ id: `K${order.listing_id}`, name: 'Kargo ücreti', category1: 'Kargo', itemType: Iyzipay.BASKET_ITEM_TYPE.PHYSICAL,
          price: tl(order.shipping_fee), subMerchantKey, subMerchantPrice: tl(order.shipping_fee) }] : []),
      ],
    };
    const res = await call('checkoutFormInitialize', 'create', req);
    if (res.status !== 'success') throw fail(res);
    return { token: res.token, html: res.checkoutFormContent, pageUrl: res.paymentPageUrl };
  },

  async finishCheckout(token, order) {
    const res = await call('checkoutForm', 'retrieve', { locale: 'tr', conversationId: order.code, token });
    if (res.status !== 'success' || res.paymentStatus !== 'SUCCESS') return { ok: false, error: res.errorMessage || 'Ödeme tamamlanmadı.' };
    if (res.basketId !== order.code || Number(res.paidPrice) !== Number(order.total)) return { ok: false, error: 'Ödeme bilgileri siparişle eşleşmiyor.' };
    const txIds = (res.itemTransactions || []).map((t) => ({ id: t.paymentTransactionId, paid: t.paidPrice }));
    return { ok: true, paymentId: res.paymentId, txIds };
  },

  // Satıcıya aktarım onayı
  async release(order) {
    for (const t of JSON.parse(order.tx_ids || '[]')) {
      const res = await call('approval', 'create', { locale: 'tr', conversationId: order.code, paymentTransactionId: t.id });
      if (res.status !== 'success') throw fail(res);
    }
    return { ok: true };
  },

  // Alıcıya iade
  async refund(order, ip = '127.0.0.1') {
    for (const t of JSON.parse(order.tx_ids || '[]')) {
      const res = await call('refund', 'create', { locale: 'tr', conversationId: order.code, paymentTransactionId: t.id,
        price: tl(t.paid), currency: Iyzipay.CURRENCY.TRY, ip });
      if (res.status !== 'success') throw fail(res);
    }
    return { ok: true };
  },
};
