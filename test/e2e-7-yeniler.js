// env: {"PUSH_DISABLED": "1"}
// Güvenlik başlıkları, hesap kilidi, yeni cihaz uyarısı, e-posta değiştirme, teklifler (fiyat/karşı/takas → teklifli kargo),
// bedava ilan, paylaş, güvenilir satıcı, fiyat düştü, canlı mesaj, telefona bildirim aboneliği, yönetim grafikleri
const { chromium } = require('playwright');
const { B, ok, sql, mails, lastLink, shot } = require('./helpers');

(async () => {
  const br = await chromium.launch(); const errs = []; const cspHata = [];
  const mk = async (w = 390) => {
    const c = await br.newContext({ viewport: { width: w, height: 900 } });
    const p = await c.newPage();
    p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
    p.on('console', (m) => { if (/Content Security Policy|Refused to/.test(m.text())) cspHata.push(m.text()); });
    return p;
  };
  const A = await mk(1280), S = await mk(), C = await mk(1280);
  const register = async (p, name, email) => {
    await p.goto(B + '/kayit'); await p.fill('[name=name]', name); await p.fill('[name=email]', email);
    await p.fill('[name=password]', 'sifre12345'); await p.fill('[name=password2]', 'sifre12345'); await p.check('[name=kvkk]');
    await Promise.all([p.waitForNavigation(), p.click('form.kart-form button.tam')]);
  };
  const login = async (p, email, pass = 'sifre12345') => {
    await p.goto(B + '/giris'); await p.fill('[name=email]', email); await p.fill('[name=password]', pass);
    await Promise.all([p.waitForNavigation(), p.click('form.kart-form button.tam')]);
  };
  const flash = async (p) => (await p.locator('.flash').first().textContent().catch(() => '')) || '';
  const ilanVer = async (p, title, { price = 1000, tur = 'satilik' } = {}) => {
    await p.goto(B + '/ilan-ver'); await p.fill('[name=title]', title); await p.selectOption('[name=category]', 'spor-outdoor');
    await p.selectOption('[name=condition]', 'az'); await p.check(`input[name=tur][value=${tur}]`);
    if (!['takas', 'bedava'].includes(tur)) await p.fill('[name=price]', String(price));
    await p.selectOption('.js-il', 'izmir'); await p.selectOption('.js-ilce', 'buca'); await p.fill('textarea[name=description]', 'Temiz, sorunsuz, hemen teslim.');
    await Promise.all([p.waitForNavigation(), p.click('form.kart-form button.tam')]);
    return { url: p.url(), id: parseInt(p.url().match(/ilan\/(\d+)/)[1], 10) };
  };

  await register(A, 'Yönetici Ates', 'admin@test.com');
  sql("UPDATE users SET is_admin = 1 WHERE email = 'admin@test.com'");
  await register(S, 'Satıcı Selin', 'selin@test.com');
  await register(C, 'Alıcı Cem', 'cem@test.com');

  // ---- A. Güvenlik başlıkları ----
  const r = await C.goto(B + '/');
  const hd = r.headers();
  ok(/default-src 'self'/.test(hd['content-security-policy'] || ''), 'CSP başlığı var');
  ok(/frame-ancestors 'self'/.test(hd['content-security-policy'] || ''), 'CSP sitenin başka sitelerde çerçevelenmesini engelliyor');
  ok(hd['x-content-type-options'] === 'nosniff' && !!hd['referrer-policy'], 'diğer güvenlik başlıkları var');
  ok(!hd['strict-transport-security'], 'yerelde (http) HSTS gönderilmiyor');

  // ---- A. Hesap kilidi: 5 yanlış şifre ----
  const X = await mk();
  for (let i = 0; i < 5; i++) await login(X, 'selin@test.com', 'yanlis-sifre');
  ok((await X.content()).includes('kilitlendi') || (await X.content()).includes('kilitli'), '5 yanlış şifreden sonra hesap kilitlendi');
  await login(X, 'selin@test.com');
  ok(!X.url().endsWith('/') || (await X.content()).includes('kilit'), 'kilitliyken doğru şifre de kabul edilmiyor');
  ok(mails('selin@test.com').some((m) => m.includes('kilitlendi')), 'kilit için e-posta gitti');
  sql("UPDATE users SET locked_until = NULL, failed_logins = 0 WHERE email = 'selin@test.com'");

  // ---- A. Yeni cihaz uyarısı ----
  const once = mails('selin@test.com').filter((m) => m.includes('yeni bir cihazdan')).length;
  await login(X, 'selin@test.com');
  ok(mails('selin@test.com').filter((m) => m.includes('yeni bir cihazdan')).length === once + 1, 'yeni cihazdan girişte e-posta uyarısı gitti');
  await X.context().close();

  // ---- B. E-posta değiştirme ----
  await C.goto(B + '/hesabim/ayarlar');
  await C.fill('#eposta [name=new_email]', 'cem.yeni@test.com'); await C.fill('#eposta [name=password]', 'yanlis');
  await Promise.all([C.waitForNavigation(), C.click('#eposta button.btn')]);
  ok((await flash(C)).includes('Şifre hatalı'), 'yanlış şifreyle e-posta değişmiyor');
  await C.fill('#eposta [name=new_email]', 'selin@test.com'); await C.fill('#eposta [name=password]', 'sifre12345');
  await Promise.all([C.waitForNavigation(), C.click('#eposta button.btn')]);
  ok((await flash(C)).includes('başka bir hesap'), 'başkasının e-postasına geçilemiyor');
  await C.fill('#eposta [name=new_email]', 'cem.yeni@test.com'); await C.fill('#eposta [name=password]', 'sifre12345');
  await Promise.all([C.waitForNavigation(), C.click('#eposta button.btn')]);
  ok((await flash(C)).includes('onay bağlantısı'), 'onay bağlantısı gönderildi');
  ok(sql("SELECT email FROM users WHERE email = 'cem@test.com'").includes('cem@test.com'), 'onaylanmadan e-posta değişmedi');
  ok(mails('cem@test.com').some((m) => m.includes('değiştirme isteği')), 'eski adrese bilgi e-postası gitti');
  const onay = lastLink('cem.yeni@test.com', /http:\/\/[^\s"'<]+\/eposta-onay\/[A-Za-z0-9_-]+/);
  ok(!!onay, 'yeni adrese onay bağlantısı gitti');
  await C.goto(onay);
  ok((await flash(C)).includes('cem.yeni@test.com'), 'onaylanınca e-posta değişti');
  ok(sql("SELECT email_verified FROM users WHERE email = 'cem.yeni@test.com'").includes('"email_verified":1'), 'yeni adres doğrulanmış sayıldı');
  ok(mails('cem@test.com').some((m) => m.includes('adresin değişti') || m.includes('adresi değişti')), 'eski adrese "değişti" e-postası gitti');
  await C.goto(onay);
  ok((await C.content()).includes('geçersiz'), 'bağlantı ikinci kez kullanılamıyor');

  // ---- D. Bedava ilan ----
  const bedava = await ilanVer(S, 'Bedava Kitap Kolisi', { tur: 'bedava' });
  ok(sql('SELECT price, is_swap, shipping FROM listings WHERE id = ?', bedava.id).includes('"price":0,"is_swap":0,"shipping":0'), 'bedava ilan 0 TL, kargosuz kaydedildi');
  ok(await S.locator('.detay-fiyat .bedava-rozet').count() === 1, 'ilan sayfasında Bedava rozeti');
  await C.goto(B + '/ilanlar?tip=bedava');
  ok((await C.content()).includes('Bedava Kitap Kolisi') && await C.locator('.kart .bedava-rozet').count() >= 1, 'Bedava filtresi bedava ilanı gösteriyor');
  ok(!(await C.content()).includes('Çocuk Bisikleti'), 'Bedava filtresi ücretli ilanları göstermiyor');
  await C.goto(B + '/ilanlar?tip=satilik');
  ok(!(await C.content()).includes('Bedava Kitap Kolisi'), 'Satılık filtresi bedava ilanı göstermiyor');

  // ---- C. Fiyat teklifi → karşı teklif → kabul → teklif fiyatından kargo ----
  sql(`INSERT INTO payout_accounts (user_id, first_name, last_name, phone, address, iban_enc, iban_last4, tckn_enc, sub_merchant_key)
       SELECT id, 'Selin', 'Kaya', '05320000000', 'Örnek Mah. No:1 Buca İzmir', 'x', '1326', 'x', 'test-sm' FROM users WHERE email = 'selin@test.com'`);
  const bisiklet = await ilanVer(S, 'Kırmızı Yol Bisikleti', { price: 1000, tur: 'ikisi' });
  sql('UPDATE listings SET shipping = 1 WHERE id = ?', bisiklet.id);
  await C.goto(bisiklet.url);
  ok(await C.locator('.paylas .paylas-btn.wa').count() === 1 && await C.locator('[data-kopyala]').count() === 1, 'WhatsApp ve bağlantı kopyalama butonları var');
  await C.locator('#teklif summary').click();
  ok(await C.locator('.teklif-form').isVisible(), 'Teklif ver formu açıldı');
  await C.fill('.teklif-form [name=amount]', '1200');
  await Promise.all([C.waitForNavigation(), C.click('.teklif-form button.btn')]);
  ok((await flash(C)).includes('düşük olmalı'), 'ilan fiyatından yüksek teklif reddedildi');
  await C.locator('#teklif summary').click();
  await C.fill('.teklif-form [name=amount]', '800'); await C.fill('.teklif-form [name=note]', 'Yarın alabilirim');
  await Promise.all([C.waitForNavigation(), C.click('.teklif-form button.btn')]);
  ok((await flash(C)).includes('satıcıya iletildi'), '800 TL teklif gönderildi');
  ok((await C.locator('.teklif-son').textContent()).includes('800'), 'ilan sayfasında teklifin durumu görünüyor');
  ok(mails('selin@test.com').some((m) => m.includes('yeni teklif')), 'satıcıya teklif e-postası gitti');

  await S.goto(bisiklet.url);
  ok((await S.locator('.teklif-uyari').textContent()).includes('1'), 'satıcı ilan sayfasında bekleyen teklif uyarısı görüyor');
  await S.goto(B + '/tekliflerim');
  ok((await S.content()).includes('Yarın alabilirim'), 'gelen teklifte alıcının notu görünüyor');
  await shot(S, 'g-teklif-gelen.png');
  await S.fill('.karsi-form [name=amount]', '950');
  await Promise.all([S.waitForNavigation(), S.click('.karsi-form button')]);
  ok((await flash(S)).includes('Karşı teklif'), 'satıcı 950 TL karşı teklif verdi');

  await C.goto(B + '/tekliflerim?sekme=giden');
  ok((await C.content()).includes('950'), 'alıcı karşı teklifi görüyor');
  await Promise.all([C.waitForNavigation(), C.click('form[action$="/kabul"] button')]);
  ok((await flash(C)).includes('kabul ettin'), 'alıcı karşı teklifi kabul etti');
  ok(sql("SELECT amount, status FROM offers WHERE listing_id = ?", bisiklet.id).includes('"amount":950,"status":"kabul"'), 'kabul edilen fiyat 950 TL');
  await shot(C, 'g-teklif-giden.png');
  await Promise.all([C.waitForNavigation(), C.click('a[href*="satin-al?teklif="]')]);
  ok((await C.locator('.tutar-tablo').textContent()).includes('950'), 'kargolu satın almada ürün fiyatı 950 TL');
  const teklifId = sql('SELECT id FROM offers WHERE listing_id = ?', bisiklet.id).match(/"id":(\d+)/)[1];
  await C.fill('[name=ship_name]', 'Cem Demir'); await C.fill('[name=ship_phone]', '05321112233');
  await C.selectOption('.js-il', 'ankara'); await C.selectOption('.js-ilce', 'cankaya');
  await C.fill('[name=ship_address]', 'Kızılay Mah. Atatürk Bulvarı No:10 D:4'); await C.check('[name=onay]');
  await Promise.all([C.waitForNavigation(), C.click('form.kart-form button.tam')]);
  ok(sql('SELECT item_price, offer_id FROM orders WHERE listing_id = ?', bisiklet.id).includes(`"item_price":950,"offer_id":${teklifId}`), 'sipariş teklif fiyatıyla (950 TL) oluştu');
  // Başkasının teklifi kullanılamaz
  await A.goto(B + `/ilan/${bisiklet.id}/satin-al?teklif=${teklifId}`);
  ok((await flash(A)).includes('geçerli değil') || (await flash(A)).includes('satın alınıyor'), 'başkasının teklifiyle indirimli alınamıyor');

  // ---- C. Takas teklifi ----
  const kaykay = await ilanVer(C, 'Cemin Kaykayı', { price: 400 });
  const takaslik = await ilanVer(S, 'Takaslık Gitar', { tur: 'takas' });
  await C.goto(takaslik.url);
  await C.locator('#teklif summary').click();
  ok(await C.locator('.teklif-form select[name=swap_listing_id] option').count() >= 1, 'takas için kendi ilanları listeleniyor');
  await C.selectOption('.teklif-form [name=swap_listing_id]', String(kaykay.id));
  await Promise.all([C.waitForNavigation(), C.click('.teklif-form button.btn')]);
  ok((await flash(C)).includes('satıcıya iletildi'), 'takas teklifi gönderildi');
  await S.goto(B + '/tekliflerim');
  ok((await S.content()).includes('Cemin Kaykayı'), 'satıcı takas önerilen ilanı görüyor');
  await Promise.all([S.waitForNavigation(), S.locator('.teklif-kart', { hasText: 'Cemin Kaykayı' }).locator('form[action$="/red"] button').click()]);
  ok((await flash(S)).includes('reddettin'), 'satıcı takas teklifini reddetti');
  ok(sql("SELECT COUNT(*) n FROM notifications WHERE text LIKE '%reddedildi%'").includes('"n":1'), 'alıcıya ret bildirimi düştü');

  // ---- D. Güvenilir satıcı rozeti ----
  await C.goto(takaslik.url);
  ok(await C.locator('.guven-rozet').count() === 0, 'değerlendirmesi olmayan satıcıda rozet yok');
  sql("UPDATE users SET email_verified = 1 WHERE email = 'selin@test.com'");
  for (const lid of [bisiklet.id, bedava.id, takaslik.id]) {
    sql(`INSERT INTO reviews (listing_id, reviewer_id, seller_id, score) SELECT ?, (SELECT id FROM users WHERE email = 'admin@test.com'), id, 5 FROM users WHERE email = 'selin@test.com'`, lid);
  }
  await C.goto(takaslik.url);
  ok(await C.locator('.satici-kart .guven-rozet').count() === 1, '3 tane 5 yıldızlı değerlendirmeden sonra "Güvenilir satıcı" rozeti');
  const sid = sql("SELECT id FROM users WHERE email = 'selin@test.com'").match(/"id":(\d+)/)[1];
  await C.goto(B + '/uye/' + sid);
  ok(await C.locator('h1 .guven-rozet').count() === 1, 'profil sayfasında da rozet var');

  // ---- E. Fiyat düştü uyarısı ----
  const masa = await ilanVer(S, 'Ahşap Çalışma Masası', { price: 2000 });
  await C.goto(masa.url);
  await C.click('.fav-form button');
  await S.goto(B + `/ilan/${masa.id}/duzenle`);
  await S.fill('[name=price]', '1500');
  await Promise.all([S.waitForNavigation(), S.click('form.kart-form button.tam')]);
  ok(mails('cem.yeni@test.com').some((m) => m.includes('Fiyatı düştü') && m.includes('1.500')), 'favoriye ekleyene fiyat düştü e-postası gitti');
  ok(sql("SELECT COUNT(*) n FROM notifications WHERE icon = '📉'").includes('"n":1'), 'fiyat düştü zil bildirimi düştü');

  // ---- E. Canlı mesaj ----
  await C.goto(B + `/mesajlar/${masa.id}/${sid}`);
  await C.fill('.mesaj-yaz textarea', 'Merhaba, masa duruyor mu?');
  const adres = C.url();
  await C.click('.mesaj-yaz button.btn');
  await C.waitForSelector('.balon.benim:has-text("masa duruyor mu")', { timeout: 8000 });
  ok(C.url() === adres && (await C.inputValue('.mesaj-yaz textarea')) === '', 'mesaj sayfa yenilenmeden gönderildi');
  const cid = sql("SELECT id FROM users WHERE email = 'cem.yeni@test.com'").match(/"id":(\d+)/)[1];
  await S.goto(B + `/mesajlar/${masa.id}/${cid}`);
  await S.fill('.mesaj-yaz textarea', 'Evet, duruyor 🙂');
  await S.click('.mesaj-yaz button.btn');
  await C.waitForSelector('.balon:not(.benim):has-text("duruyor")', { timeout: 10000 }).catch(() => {});
  ok(await C.locator('.balon:not(.benim)', { hasText: 'duruyor' }).count() === 1, 'karşı tarafın mesajı sayfa yenilenmeden geldi');
  ok(await C.locator('.balon').count() === 2, 'mesajlar çift eklenmedi');
  await shot(C, 'g-canli-mesaj.png');
  const sayac = await S.evaluate(() => fetch('/canli/sayac').then((r) => r.json()));
  ok(typeof sayac.bildirim === 'number' && typeof sayac.mesaj === 'number', 'zil/mesaj sayacı sayfa yenilemeden sorulabiliyor');

  // ---- E. Telefona bildirim aboneliği ----
  await C.goto(B + '/bildirimler');
  ok(await C.locator('[data-push]').count() === 1, 'bildirimler sayfasında "telefonuna da bildirim" kutusu var');
  const anahtar = await C.evaluate(() => fetch('/push/anahtar').then((r) => r.json()));
  ok(typeof anahtar.key === 'string' && anahtar.key.length > 80, 'VAPID anahtarı üretildi');
  const abone = await C.evaluate(() => {
    const fd = new URLSearchParams();
    fd.set('_csrf', document.querySelector('input[name=_csrf]').value);
    fd.set('sub', JSON.stringify({ endpoint: 'https://push.example.com/abc123', keys: { p256dh: 'BKey', auth: 'auth1' } }));
    return fetch('/push/abone', { method: 'POST', body: fd }).then((r) => r.status);
  });
  ok(abone === 200 && sql('SELECT COUNT(*) n FROM push_subscriptions').includes('"n":1'), 'telefona bildirim aboneliği kaydedildi');
  const kotu = await C.evaluate(() => {
    const fd = new URLSearchParams(); fd.set('_csrf', document.querySelector('input[name=_csrf]').value); fd.set('sub', '{"endpoint":"http://kotu"}');
    return fetch('/push/abone', { method: 'POST', body: fd }).then((r) => r.status);
  });
  ok(kotu === 400, 'geçersiz abonelik reddedildi');

  // ---- F. Yönetim grafikleri ----
  await A.goto(B + '/yonetim?tab=grafik');
  ok(await A.locator('.yg-grafik svg').count() === 6, 'yönetim panelinde 6 grafik var');
  ok(await A.locator('.yg-grafik path.cubuk').count() > 0, 'grafiklerde veri çubukları çiziliyor');
  ok((await A.locator('.yg-grafik', { hasText: 'Teklifler' }).textContent()).includes('2'), 'teklif grafiği toplamı doğru (2)');
  await shot(A, 'g-grafikler.png');
  await S.goto(B + '/yonetim?tab=grafik');
  ok(!(await S.content()).includes('İstatistikler'), 'yönetici olmayan grafikleri göremiyor');

  ok(!cspHata.length, 'hiçbir sayfada CSP engeli yok' + (cspHata.length ? ': ' + cspHata[0] : ''));
  ok(!errs.length, 'tarayıcıda JavaScript hatası yok' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await br.close();
})().catch((e) => { console.error(e); process.exit(1); });
