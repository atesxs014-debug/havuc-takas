const { chromium } = require('playwright');
const { execSync } = require('child_process');
const { B, ok, sql, run, shot } = require('./helpers');
(async () => {
  const br = await chromium.launch(); const errs = [];
  const mk = async (w = 390) => { const c = await br.newContext({ viewport: { width: w, height: 900 } }); const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); return p; };
  const S = await mk(1280), A = await mk(), C = await mk();
  const register = async (p, name, email) => { await p.goto(B + '/kayit'); await p.fill('[name=name]', name); await p.fill('[name=email]', email);
    await p.fill('[name=password]', 'sifre12345'); await p.fill('[name=password2]', 'sifre12345'); await p.check('[name=kvkk]'); await p.click('form.kart-form button.tam'); };
  await register(S, 'Satıcı Ates', 'satici@test.com');
  const ilanVer = async (title, price, kargo = true) => {
    await S.goto(B + '/ilan-ver'); await S.fill('[name=title]', title); await S.selectOption('[name=category]', 'spor-outdoor'); await S.selectOption('[name=condition]', 'iyi'); await S.fill('[name=price]', String(price));
    await S.selectOption('.js-il', 'izmir'); await S.selectOption('.js-ilce', 'buca'); await S.fill('textarea[name=description]', 'Temiz kullanılmış, sorunsuz çalışıyor.');
    if (kargo) { await S.check('[name=shipping]'); await S.check('input[name=package_size][value=orta]', { force: true }); }
    await S.click('form.kart-form button.tam');
  };
  await ilanVer('Dağ Bisikleti 26 Jant', 1000);
  ok((await S.content()).includes('ödeme bilgilerini'), 'ödeme bilgisi yokken kargolu ilan engellendi');
  await S.goto(B + '/hesabim/odeme-bilgileri');
  await S.fill('[name=first_name]', 'Ates'); await S.fill('[name=last_name]', 'Yilmaz'); await S.fill('[name=phone]', '0532 000 00 00');
  await S.fill('[name=address]', 'Örnek Mah. Deneme Sok. No:5 D:3 Buca İzmir'); await S.fill('[name=iban]', 'TR33 0006 1005 1978 6457 8413 27'); await S.fill('[name=tckn]', '10000000146');
  await S.check('[name=onay]'); await S.click('form.kart-form button');
  ok((await S.content()).includes('IBAN geçersiz'), 'hatalı IBAN reddedildi');
  await S.fill('[name=iban]', 'TR33 0006 1005 1978 6457 8413 26'); await S.fill('[name=tckn]', '10000000146'); await S.check('[name=onay]'); await S.click('form.kart-form button');
  ok((await S.locator('.flash').first().textContent()).includes('kaydedildi'), 'ödeme bilgileri kaydedildi (test alt üye)');
  const enc = sql("SELECT iban_enc, iban_last4 FROM payout_accounts"); ok(!enc.includes('TR33') && enc.includes('1326'), 'IBAN veritabanında şifreli');
  await ilanVer('Dağ Bisikleti 26 Jant', 1000); const bisiklet = S.url();
  await ilanVer('Kamp Çadırı 4 Kişilik', 2000); const cadir = S.url();
  await ilanVer('Kaykay', 500); const kaykay = S.url();
  await S.goto(B + '/ilanlar'); ok(await S.locator('.kargo-rozet').count() === 3, 'kartlarda 📦 Kargo rozeti');
  // alıcı
  await register(A, 'Alıcı Mehmet', 'alici@test.com');
  await A.goto(bisiklet); const btn = await A.locator('a:has-text("Kargoyla Satın Al")').textContent();
  ok(btn.includes('1.180 TL'), `satın al butonu: ${btn.trim()} (1000 + 130 kargo + 50 hizmet)`);
  await A.click('a:has-text("Kargoyla Satın Al")');
  await A.fill('[name=ship_phone]', '0555 111 22 33'); await A.selectOption('.js-il', 'ankara'); await A.selectOption('.js-ilce', 'cankaya');
  await A.fill('textarea[name=ship_address]', 'Kızılay Mah. Atatürk Bulvarı No:10 Daire 4'); await A.check('[name=onay]');
  await shot(A, 'k-checkout.png');
  await A.click('form.kart-form button.btn-turuncu');
  ok(A.url().includes('/test-odeme'), 'test ödeme sayfası açıldı');
  await A.click('button[value=basarili]');
  ok((await A.locator('.durum').textContent()).includes('Ödendi'), 'sipariş ödendi');
  const code1 = A.url().split('/siparis/')[1].split('?')[0];
  await C.goto(bisiklet); ok(await C.locator('a:has-text("Kargoyla Satın Al")').count() === 0, 'satılan ürün başkası tarafından alınamıyor');
  // satıcı kargoya veriyor
  await S.goto(B + '/siparislerim?tab=satis'); ok((await S.content()).includes('Senden kargo bekleniyor'), 'satıcının siparişlerinde bekleyen iş');
  await S.goto(B + '/siparis/' + code1); ok((await S.content()).includes('Atatürk Bulvarı'), 'satıcı teslimat adresini görüyor');
  await S.selectOption('[name=carrier]', 'yurtici'); await S.fill('[name=tracking_no]', '123456789012'); await S.click('button:has-text("Kargoya verdim")');
  ok((await S.locator('.durum').textContent()).includes('Kargoda'), 'kargoya verildi');
  await A.goto(B + '/siparis/' + code1); await shot(A, 'k-order.png');
  await A.click('button:has-text("Teslim aldım")'); ok((await A.locator('.durum').textContent()).includes('Tamamlandı'), 'alıcı onayladı → tamamlandı');
  await A.click('a:has-text("Satıcıyı puanla")'); ok(await A.locator('.puan-form').count() === 1, 'kargolu alıcı satıcıyı puanlayabiliyor');
  // ikinci sipariş: itiraz → iade
  await A.goto(cadir); await A.click('a:has-text("Kargoyla Satın Al")');
  await A.fill('[name=ship_phone]', '0555 111 22 33'); await A.selectOption('.js-il', 'ankara'); await A.selectOption('.js-ilce', 'cankaya');
  await A.fill('textarea[name=ship_address]', 'Kızılay Mah. Atatürk Bulvarı No:10 Daire 4'); await A.check('[name=onay]'); await A.click('form.kart-form button.btn-turuncu'); await A.click('button[value=basarili]');
  const code2 = A.url().split('/siparis/')[1].split('?')[0];
  await A.click('summary:has-text("Sorun var")'); await A.selectOption('select[name=reason]', 'Ürün gelmedi'); await A.click('.sikayet button');
  ok((await A.locator('.durum').textContent()).includes('Sorun bildirildi'), 'alıcı sorun bildirdi');
  await S.goto(B + '/yonetim?tab=siparis'); ok((await S.content()).includes('Ürün gelmedi'), 'yönetimde itiraz görünüyor');
  await shot(S, 'k-admin.png');
  await S.locator(`article:has-text("${code2}") button:has-text("Alıcıya iade et")`).click();
  ok((await S.locator('.flash').textContent()).includes('iade'), 'yönetici iade etti');
  await C.goto(cadir); ok(await C.locator('a:has-text("Kargoyla Satın Al")').count() === 1, 'iade sonrası ilan tekrar satışta');
  // üçüncü sipariş: satıcı 3 günde kargolamadı → otomatik iade
  await A.goto(kaykay); await A.click('a:has-text("Kargoyla Satın Al")');
  await A.fill('[name=ship_phone]', '0555 111 22 33'); await A.selectOption('.js-il', 'ankara'); await A.selectOption('.js-ilce', 'cankaya');
  await A.fill('textarea[name=ship_address]', 'Kızılay Mah. Atatürk Bulvarı No:10 Daire 4'); await A.check('[name=onay]'); await A.click('form.kart-form button.btn-turuncu'); await A.click('button[value=basarili]');
  const code3 = A.url().split('/siparis/')[1].split('?')[0];
  sql(`UPDATE orders SET paid_at = '2020-01-01T00:00:00.000Z' WHERE code = '${code3}'`);
  run("require('./lib/orders').otomatik().then(()=>process.exit(0))");
  await A.goto(B + '/siparis/' + code3); ok((await A.locator('.durum').textContent()).includes('İade'), 'kargolanmayan sipariş otomatik iade edildi');
  // kargo ayarları
  await S.goto(B + '/yonetim?tab=kargo'); await S.fill('[name=kargo_orta]', '150'); await S.fill('[name=hizmet_yuzde]', '4'); await S.click('form[action="/yonetim/kargo"] button');
  await C.goto(cadir); ok((await C.locator('a:has-text("Kargoyla Satın Al")').textContent()).includes('2.230 TL'), 'ayar değişti: 2000 + 150 + 80 = 2.230 TL');
  console.log('JS hataları:', errs); await br.close();
})();
