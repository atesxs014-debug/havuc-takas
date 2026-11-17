// env: {"REQUIRE_EMAIL_VERIFICATION": "1", "BANK_IBAN": "TR12 0006 4000 0011 2345 6789 01", "BANK_HOLDER": "Ates Yilmaz", "BANK_NAME": "Örnek Bank"}
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const { B, UPLOADS, ok, lastLink, shot } = require('./helpers');
(async () => {
  const br = await chromium.launch();
  const errs = [];
  const mk = async () => { const c = await br.newContext({ viewport: { width: 390, height: 844 } }); const p = await c.newPage();
    p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); return p; };
  const A = await mk(), U = await mk();
  const register = async (p, name, email) => {
    await p.goto(B + '/kayit'); await p.fill('[name=name]', name); await p.fill('[name=email]', email);
    await p.fill('[name=password]', 'sifre12345'); await p.fill('[name=password2]', 'sifre12345'); await p.check('[name=kvkk]'); await p.click('form.kart-form button.tam');
  };
  // 1) kayıt + doğrulama
  await register(A, 'Yönetici Ates', 'admin@test.com');
  await A.goto(B + '/ilan-ver'); ok(await A.locator('h1:has-text("Önce e-postanı doğrula")').count() === 1, 'doğrulanmamış kullanıcı ilan veremiyor');
  await A.goto(lastLink('admin@test.com', /http:\/\/\S+\/dogrula\/\S+/)); ok((await A.locator('.flash').textContent()).includes('doğrulandı'), 'e-posta doğrulama bağlantısı çalışıyor');
  // 2) fiyatlar
  await A.goto(B + '/yonetim?tab=fiyatlar');
  for (const [k, v] of [['ilce_buyuk3', '750'], ['il_buyuk3', '2500'], ['ilce_buyuksehir', '400'], ['il_buyuksehir', '1500'], ['ilce_diger', '250'], ['il_diger', '800']]) await A.fill(`[name=${k}]`, v);
  await A.click('form[action="/yonetim/fiyatlar"] button');
  await A.selectOption('form[action="/yonetim/fiyatlar/ozel"] .js-il', 'izmir'); await A.selectOption('form[action="/yonetim/fiyatlar/ozel"] .js-ilce', 'karsiyaka');
  await A.fill('form[action="/yonetim/fiyatlar/ozel"] [name=price]', '1000'); await A.click('form[action="/yonetim/fiyatlar/ozel"] button');
  ok((await A.content()).includes('Karşıyaka, İzmir'), 'kademeli fiyat + özel fiyat kaydedildi');
  // 3) çok fotoğraflı ilan
  await A.goto(B + '/ilan-ver');
  await A.fill('[name=title]', 'Akustik Gitar Yamaha'); await A.selectOption('[name=category]', 'kitap-hobi'); await A.selectOption('[name=condition]', 'iyi'); await A.fill('[name=price]', '2750');
  await A.selectOption('.js-il', 'izmir'); await A.selectOption('.js-ilce', 'buca');
  await A.fill('textarea[name=description]', 'Çok temiz akustik gitar, kılıfı ile birlikte.');
  await A.setInputFiles('[name=photos]', ['fixtures/p1.png', 'fixtures/p2.png', 'fixtures/p3.png']); await A.click('form.kart-form button.tam');
  const gitarUrl = A.url();
  ok(await A.locator('.galeri-kucuk button').count() === 3, '3 fotoğraf yüklendi, galeri gösteriliyor');
  const src0 = await A.locator('[data-galeri-ana]').getAttribute('src'); await A.click('[data-galeri-sonraki]');
  ok(src0 !== await A.locator('[data-galeri-ana]').getAttribute('src'), 'galeri ileri butonu çalışıyor');
  const sz = fs.statSync(path.join(UPLOADS, path.basename(src0))).size; ok(src0.endsWith('.webp') && sz < 400000, `fotoğraf webp'ye küçültüldü (${Math.round(sz / 1024)} KB)`);
  const og = await A.locator('meta[property="og:image"]').getAttribute('content'); ok(og.includes('/uploads/'), 'og:image ilan fotoğrafı');
  ok(await A.locator('script[type="application/ld+json"]').count() === 1, 'yapısal veri (Product) var');
  // düzenle: 1 sil, 2 ekle
  await A.goto(gitarUrl.replace(/\/ilan\/(\d+).*/, '/ilan/$1/duzenle'));
  await A.locator('[name=remove_img]').first().check(); await A.setInputFiles('[name=photos]', ['fixtures/p4.png', 'fixtures/p1.png']);
  await A.click('form.kart-form button.tam'); ok(await A.locator('.galeri-kucuk button').count() === 4, 'düzenlemede foto silme/ekleme çalışıyor (4 foto)');
  // 4) yasaklı kelime
  await A.goto(B + '/ilan-ver');
  await A.fill('[name=title]', 'Sıfır telefon acil'); await A.selectOption('[name=category]', 'elektronik'); await A.selectOption('[name=condition]', 'sifir'); await A.fill('[name=price]', '5000');
  await A.selectOption('.js-il', 'ankara'); await A.selectOption('.js-ilce', 'cankaya');
  await A.fill('textarea[name=description]', 'Kaporası gönderilirse kargolarım, iyi durumda.'); await A.click('form.kart-form button.tam');
  ok((await A.locator('.flash').first().textContent()).includes('inceleme'), 'yasaklı kelimeli ilan incelemeye düştü');
  await A.goto(B + '/ilanlar?q=Sıfır'); ok(await A.locator('.kart').count() === 0, 'incelemedeki ilan listede görünmüyor');
  await A.goto(B + '/yonetim?tab=onay'); ok((await A.content()).includes('kapora'), 'yönetimde yakalanan kelime görünüyor');
  await A.click('button:has-text("Onayla, yayınla")'); await A.goto(B + '/ilanlar?q=Sıfır'); ok(await A.locator('.kart').count() === 1, 'onaylanan ilan yayına girdi');
  // 5) işletme başvurusu
  await register(U, 'Buca Fırını', 'firin@test.com');
  await U.goto(lastLink('firin@test.com', /http:\/\/\S+\/dogrula\/\S+/));
  await U.goto(B + '/reklam-ver?il=izmir&ilce=buca'); await U.waitForSelector('.alan-secenek');
  await U.selectOption('[name=months]', '3');
  ok((await U.locator('#tutar').textContent()).startsWith('2.250 TL'), 'tutar: büyük 3 ilçe 750×3 = 2.250 TL');
  await U.fill('[name=business_name]', 'Buca Lezzet Fırını'); await U.fill('textarea[name=description]', 'Her sabah taze ekmek ve pastalar.');
  await U.fill('[name=phone]', '0532 111 22 33'); await U.fill('[name=website]', 'example.com'); await U.setInputFiles('[name=image]', 'fixtures/p2.png'); await U.check('[name=kvkk]');
  await U.click('#reklamForm button.tam');
  const thanks = await U.content(); ok(thanks.includes('TR12 0006') && thanks.includes('HVC') && thanks.includes('2.250 TL'), 'teşekkür sayfasında IBAN, referans kodu ve tutar var');
  ok(lastLink('firin@test.com', /IBAN: TR12[^\n]*/) !== null, 'işletmeye ödeme bilgili e-posta gitti');
  await U.goto(B + '/isletme'); ok((await U.content()).includes('Ödeme/onay bekliyor'), 'işletme panelinde başvuru görünüyor');
  await A.goto(B + '/yonetim'); await A.click('.admin-kart button:has-text("Ödeme alındı")');
  ok((await A.locator('.flash').textContent()).includes('yayında'), 'yönetici ödemeyi onaylayıp yayına aldı');
  for (let i = 0; i < 3; i++) await U.goto(B + '/il/izmir/buca');
  ok(await U.locator('.reklam h3:has-text("Buca Lezzet")').count() === 1, 'reklam Buca sayfasında');
  const r = await U.request.get(B + '/reklam/2/git', { maxRedirects: 0 }); ok(r.status() === 302, 'reklam tıklaması yönlendiriyor');
  await U.goto(B + '/isletme'); await U.click('.isletme-kart'); const st = await U.locator('.istat-sayilar strong').allTextContents();
  ok(parseInt(st[0]) >= 3 && st[1] === '1', `işletme istatistikleri: ${st[0]} gösterim, ${st[1]} tıklama`);
  await shot(U, 'm-isletme.png');
  await U.selectOption('.uzat-form [name=months]', '1'); await U.click('.uzat-form button');
  ok((await U.content()).includes('+1 ay uzatma için ödeme'), 'süre uzatma talebi oluşturuldu');
  await A.goto(B + '/yonetim?tab=aktif'); await A.click('button:has-text("Ödeme alındı → Uzat")'); ok((await A.locator('.flash').textContent()).includes('uzatıldı'), 'yönetici uzatmayı onayladı');
  // 6) favori + mesaj + puan
  await U.goto(gitarUrl); await U.click('.fav-btn'); await U.goto(B + '/favorilerim'); ok(await U.locator('.kart').count() === 1, 'favorilere eklendi');
  await U.goto(gitarUrl); await U.click('text=Satıcıya Mesaj Gönder'); await U.fill('[name=body]', 'Merhaba, gitar duruyor mu?'); await Promise.all([U.waitForNavigation(), U.click('.mesaj-yaz button.btn')]);
  ok(lastLink('admin@test.com', /mesaj gönderdi/) !== null, 'satıcıya yeni mesaj e-postası gitti');
  await A.goto(B + '/mesajlar'); await A.click('.konusmalar a'); await A.fill('[name=body]', 'Evet duruyor, yarın Buca metroda buluşalım.'); await Promise.all([A.waitForNavigation(), A.click('.mesaj-yaz button.btn')]);
  await A.goto(gitarUrl); await A.click('button[value=sold]');
  await U.goto(B + '/mesajlar'); await U.click('.konusmalar a'); ok(await U.locator('.puan-form').count() === 1, 'satış sonrası puanlama formu çıktı');
  await U.click('label[for=y5]'); await U.fill('.puan-form [name=comment]', 'Çok ilgili satıcı, teşekkürler!'); await U.click('.puan-form button');
  ok((await U.content()).includes('Çok ilgili satıcı'), 'puan ve yorum satıcı profilinde');
  await shot(U, 'm-profil.png');
  // 7) şifremi unuttum
  const V = await mk(); await V.goto(B + '/sifremi-unuttum'); await V.fill('[name=email]', 'firin@test.com'); await V.click('form.kart-form button');
  await V.goto(lastLink('firin@test.com', /http:\/\/\S+\/sifre-sifirla\/\S+/)); await V.fill('[name=password]', 'yeniSifre99'); await V.fill('[name=password2]', 'yeniSifre99'); await V.click('form.kart-form button.btn');
  ok(V.url().endsWith('/hesabim'), 'şifre sıfırlama çalışıyor');
  await V.goto(B + '/isletme'); ok(await V.locator('.isletme-kart').count() === 1, 'yeni şifreyle giriş yapılmış durumda');
  // 8) rate limit
  const W = await mk(); let last;
  for (let i = 0; i < 11; i++) { await W.goto(B + '/giris'); await W.fill('[name=email]', 'x@y.com'); await W.fill('[name=password]', 'yanlis'); last = await Promise.all([W.waitForNavigation(), W.click('form.kart-form button.tam')]); }
  ok((await W.content()).includes('Çok fazla deneme'), '11. hatalı giriş denemesi engellendi');
  // 9) SEO, PWA, yedek
  const sm = await (await A.request.get(B + '/sitemap.xml')).text(); ok(sm.includes('/il/izmir/buca') && sm.includes('/ilan/'), 'sitemap.xml il/ilçe ve ilanları içeriyor');
  const mf = await (await A.request.get(B + '/manifest.webmanifest')).json(); ok(mf.icons.length === 3, 'PWA manifest');
  await A.goto(B + '/'); const swOk = await A.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; }); ok(swOk, 'service worker etkin');
  await A.goto(B + '/yonetim?tab=yedek'); await A.click('form[action="/yonetim/yedek"] button'); ok((await A.locator('.flash').textContent()).includes('Yedek alındı'), 'elle yedek alındı');
  await A.goto(gitarUrl); await shot(A, 'm-ilan.png');
  const D = await br.newPage({ viewport: { width: 1280, height: 900 } }); await D.goto(B + '/reklam-ver?il=istanbul&ilce=kadikoy'); await D.waitForSelector('.alan-secenek'); await shot(D, 'd-reklam.png');
  console.log('JS hataları:', errs);
  await br.close();
})();
