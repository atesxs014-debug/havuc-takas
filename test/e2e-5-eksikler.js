// Hesap silme/veri indirme, ilan süresi, mesaj engelleme + fotoğraf, kayıtlı arama + zil,
// arama/filtreler, iletişim/SSS, üye engelleme
const fs = require('fs');
const { chromium } = require('playwright');
const { B, ok, sql, run, mails, shot } = require('./helpers');

(async () => {
  const br = await chromium.launch(); const errs = [];
  const mk = async (w = 390) => {
    const c = await br.newContext({ viewport: { width: w, height: 900 }, acceptDownloads: true });
    const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept()); return p;
  };
  const A = await mk(1280), S = await mk(), C = await mk();
  const register = async (p, name, email) => {
    await p.goto(B + '/kayit'); await p.fill('[name=name]', name); await p.fill('[name=email]', email);
    await p.fill('[name=password]', 'sifre12345'); await p.fill('[name=password2]', 'sifre12345'); await p.check('[name=kvkk]');
    await Promise.all([p.waitForNavigation(), p.click('form.kart-form button.tam')]);
  };
  const flash = async (p) => (await p.locator('.flash').first().textContent().catch(() => '')) || '';
  const ilanVer = async (p, title, { price = 1500, durum = 'az', il = 'izmir', ilce = 'buca', kategori = 'spor-outdoor' } = {}) => {
    await p.goto(B + '/ilan-ver'); await p.fill('[name=title]', title); await p.selectOption('[name=category]', kategori);
    await p.selectOption('[name=condition]', durum); await p.fill('[name=price]', String(price));
    await p.selectOption('.js-il', il); await p.selectOption('.js-ilce', ilce); await p.fill('textarea[name=description]', 'Temiz, sorunsuz, hemen teslim.');
    await Promise.all([p.waitForNavigation(), p.click('form.kart-form button.tam')]);
    return p.url();
  };

  await register(A, 'Yönetici Ates', 'admin@test.com');
  await register(S, 'Satıcı Selin', 'selin@test.com');
  await register(C, 'Alıcı Cem', 'cem@test.com');

  // ---- Arama kutusu + Türkçe arama ----
  await C.goto(B + '/iletisim');
  ok(await C.locator('.ust-ara input[name=q]').count() === 1, 'üst menüde arama kutusu var');
  await C.fill('.ust-ara input[name=q]', 'ÇOCUK'); await Promise.all([C.waitForNavigation(), C.press('.ust-ara input[name=q]', 'Enter')]);
  ok((await C.content()).includes('Çocuk Bisikleti'), '"ÇOCUK" araması "Çocuk Bisikleti"ni buldu');
  await C.goto(B + '/');
  ok(await C.locator('.hero-filtre input[name=q]').count() === 1, 'anasayfada arama kutusu var');

  // ---- Telefonda açılır filtre ----
  await C.goto(B + '/ilanlar');
  ok(!(await C.locator('#filtreKutu').isVisible()), 'telefonda filtre paneli kapalı başlıyor');
  await C.click('[data-filtre-ac]');
  ok(await C.locator('#filtreKutu').isVisible(), 'Filtreler butonu paneli açıyor');
  await shot(C, 'f-filtre-mobil.png');

  // ---- Kayıtlı arama → yeni ilan → zil ----
  await C.goto(B + '/ilanlar?q=kaykay&il=izmir');
  await Promise.all([C.waitForNavigation(), C.click('.arama-kaydet-satir button')]);
  ok((await flash(C)).includes('Arama kaydedildi'), 'arama kaydedildi');
  ok((await C.content()).includes('Bu arama kayıtlı'), 'sayfa aramanın kayıtlı olduğunu gösteriyor');
  ok(await C.locator('.zil .zil-sayi').count() === 0, 'başta bildirim yok');
  const kaykay = await ilanVer(S, 'Elektrikli Kaykay Xiaomi', { price: 4200, durum: 'iyi', kategori: 'elektronik' });
  await ilanVer(S, 'Kaykay Ankara', { il: 'ankara', ilce: 'cankaya' });
  await C.goto(B + '/');
  ok((await C.locator('.zil .zil-sayi').textContent()) === '1', 'kayıtlı aramaya uyan 1 ilan için zilde 1 bildirim');
  await C.click('.zil'); await C.waitForURL(/bildirimler/);
  ok((await C.content()).includes('Elektrikli Kaykay Xiaomi'), 'bildirim sayfasında yeni ilan var');
  ok(await C.locator('.zil .zil-sayi').count() === 0, 'bildirimler okununca sayaç sıfırlandı');
  run("require('./lib/bildirim').gunlukOzet()");
  ok(mails('cem@test.com').some((m) => m.includes('Kayıtlı aramalarına uyan')), 'günlük e-posta özeti gönderildi');

  // ---- Fiyat aralığı + ürün durumu ----
  await C.goto(B + '/ilanlar?il=izmir&fmin=4000&fmax=5000');
  let basliklar = await C.locator('.kart-baslik').allTextContents();
  ok(basliklar.length === 1 && basliklar[0].includes('Kaykay'), 'fiyat aralığı filtresi çalışıyor');
  await C.goto(B + '/ilanlar?il=izmir&durum=iyi&kategori=elektronik');
  basliklar = await C.locator('.kart-baslik').allTextContents();
  ok(basliklar.length === 1 && basliklar[0].includes('Kaykay'), 'ürün durumu filtresi çalışıyor');
  await C.goto(kaykay);
  ok((await C.content()).includes('İyi durumda'), 'ilan sayfasında ürün durumu görünüyor');

  // ---- Mesaj: fotoğraf + engelleme ----
  const lid = kaykay.match(/ilan\/(\d+)/)[1];
  const sid = JSON.parse(sql("SELECT id FROM users WHERE email = 'selin@test.com'"))[0].id;
  const cid = JSON.parse(sql("SELECT id FROM users WHERE email = 'cem@test.com'"))[0].id;
  await C.goto(`${B}/mesajlar/${lid}/${sid}`);
  await C.setInputFiles('[data-mesaj-foto]', 'fixtures/p3.png');
  ok(await C.locator('[data-foto-onizleme]').isVisible(), 'seçilen fotoğrafın önizlemesi görünüyor');
  await C.fill('.mesaj-yaz textarea', 'Kutusu duruyor mu?');
  await C.click('.mesaj-yaz button.btn'); await C.waitForSelector('.balon-foto img', { timeout: 8000 });
  ok(await C.locator('.balon-foto img').count() === 1, 'mesajda fotoğraf gönderildi');
  await S.goto(`${B}/mesajlar/${lid}/${cid}`);
  ok(await S.locator('.balon-foto img').count() === 1 && (await S.content()).includes('Kutusu duruyor mu?'), 'satıcı fotoğraflı mesajı görüyor');
  await shot(S, 'f-mesaj-foto.png');
  await Promise.all([S.waitForNavigation(), S.click('.sohbet-alt button')]);
  ok((await flash(S)).includes('engellendi'), 'satıcı alıcıyı engelledi');
  await C.goto(`${B}/mesajlar/${lid}/${sid}`);
  ok(await C.locator('.mesaj-yaz').count() === 0 && (await C.content()).includes('mesaj gönderemezsin'), 'engellenen kişi mesaj yazamıyor');
  await S.goto(B + '/hesabim/engellenenler');
  ok((await S.content()).includes('Alıcı Cem'), 'engellenenler listesinde görünüyor');
  await Promise.all([S.waitForNavigation(), S.click('.arama-liste button')]);
  await C.goto(`${B}/mesajlar/${lid}/${sid}`);
  ok(await C.locator('.mesaj-yaz').count() === 1, 'engel kaldırılınca mesajlaşma açıldı');

  const ilk = await ilanVer(S, 'Kamp Sandalyesi Katlanır', { price: 300, durum: 'iyi' });

  // ---- İlan süresi ----
  sql("UPDATE listings SET expires_at = datetime('now', '+2 days') WHERE title = 'Kamp Sandalyesi Katlanır'");
  run("require('./lib/ilan-sure').kontrol()");
  ok(mails('selin@test.com').some((m) => m.includes('süresi bitiyor') && m.includes('/yenile')), 'süresi bitmek üzere olan ilan için yenileme e-postası');
  sql("UPDATE listings SET expires_at = datetime('now', '-1 minutes') WHERE title = 'Kamp Sandalyesi Katlanır'");
  run("require('./lib/ilan-sure').kontrol()");
  await C.goto(B + '/ilanlar?q=sandalye');
  ok(await C.locator('.kart').count() === 0, 'süresi dolan ilan listeden kalktı');
  const sandId = ilk.match(/ilan\/(\d+)/)[1];
  await S.goto(`${B}/ilan/${sandId}/yenile`);
  await Promise.all([S.waitForNavigation(), S.click('form button.btn')]);
  ok((await flash(S)).includes('yenilendi'), 'ilan tek tıkla yenilendi');
  ok(JSON.parse(sql('SELECT status FROM listings WHERE id = ?', +sandId))[0].status === 'active', 'yenilenen ilan tekrar yayında');

  // ---- İletişim formu + SSS ----
  await C.goto(B + '/iletisim');
  await C.selectOption('[name=topic]', 'Öneri'); await C.fill('[name=body]', 'Harita görünümü olsa çok iyi olur.');
  await Promise.all([C.waitForNavigation(), C.click('form.kart-form button.tam')]);
  ok((await flash(C)).includes('gönderildi'), 'iletişim formu gönderildi');
  ok(mails('admin@test.com').some((m) => m.includes('Harita görünümü')), 'iletişim mesajı yöneticiye e-postayla gitti');
  await A.goto(B + '/yonetim?tab=iletisim');
  ok((await A.content()).includes('Harita görünümü'), 'iletişim mesajı yönetim panelinde');
  await C.goto(B + '/sss');
  ok((await C.content()).includes('FAQPage') && await C.locator('.sss-madde').count() >= 10, 'SSS sayfası ve Google FAQ verisi');

  // ---- Üye engelleme ----
  await S.goto(kaykay); const sandUrl = ilk;
  await A.goto(B + '/yonetim?tab=uye&q=selin');
  await A.click('.engel-detay summary'); await A.fill('.engel-detay [name=reason]', 'Dolandırıcılık');
  await Promise.all([A.waitForNavigation(), A.click('.engel-detay button')]);
  ok((await flash(A)).includes('kalıcı olarak engellendi'), 'yönetici üyeyi kalıcı engelledi');
  await S.goto(B + '/hesabim');
  ok(S.url().includes('/giris'), 'engellenen üyenin oturumu kapandı');
  await S.fill('[name=email]', 'selin@test.com'); await S.fill('[name=password]', 'sifre12345');
  await S.click('form.kart-form button.tam'); await S.waitForLoadState();
  ok((await S.content()).includes('kalıcı olarak engellendi'), 'engellenen üye giriş yapamıyor');
  const r = await C.goto(sandUrl);
  ok(r.status() === 404, 'engellenen üyenin ilanı ziyaretçilere kapandı');
  await C.goto(B + '/ilanlar?il=izmir');
  ok(!(await C.content()).includes('Kaykay Xiaomi'), 'engellenen üyenin ilanları listeden kalktı');
  await S.goto(B + '/kayit'); await S.fill('[name=name]', 'Selin Yeni'); await S.fill('[name=email]', 'selin@test.com');
  await S.fill('[name=password]', 'sifre12345'); await S.fill('[name=password2]', 'sifre12345'); await S.check('[name=kvkk]'); await S.click('form.kart-form button.tam');
  await S.waitForLoadState();
  ok((await S.content()).includes('zaten bir hesap var'), 'aynı e-postayla yeniden kayıt olamıyor');
  ok(mails('selin@test.com').some((m) => m.includes('engellendi')), 'engellenen üyeye e-posta gitti');
  await A.goto(B + '/yonetim?tab=uye&q=selin');
  await Promise.all([A.waitForNavigation(), A.click('form[action$="engel-kaldir"] button')]);
  ok(JSON.parse(sql("SELECT COUNT(*) AS n FROM listings WHERE user_id = ? AND status = 'expired'", sid))[0].n >= 3, 'engel kaldırılınca ilanlar "süresi doldu" oldu');

  // ---- Verilerimi indir + hesabımı sil ----
  await C.goto(B + '/hesabim/ayarlar');
  const [dl] = await Promise.all([C.waitForEvent('download'), C.click('a[href="/hesabim/verilerim"]')]);
  const veri = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok(veri.hesap.email === 'cem@test.com' && veri.mesajlar.length >= 1 && veri.kayitli_aramalar.length === 1, 'verilerim JSON olarak indi (hesap, mesaj, arama)');
  await C.goto(B + '/hesabim/sil');
  await C.fill('[name=password]', 'yanlis1234'); await C.check('[name=onay]'); await C.click('form.form button.btn-kirmizi');
  await C.waitForLoadState();
  ok((await C.content()).includes('Şifre hatalı'), 'yanlış şifreyle hesap silinmiyor');
  await C.fill('[name=password]', 'sifre12345'); await C.check('[name=onay]');
  await Promise.all([C.waitForNavigation(), C.click('form.form button.btn-kirmizi')]);
  ok((await flash(C)).includes('silindi'), 'hesap silindi');
  ok(JSON.parse(sql("SELECT COUNT(*) AS n FROM users WHERE email = 'cem@test.com'"))[0].n === 0, 'kullanıcı veritabanından silindi');
  ok(JSON.parse(sql('SELECT COUNT(*) AS n FROM messages WHERE sender_id = ? OR receiver_id = ?', cid, cid))[0].n === 0, 'mesajları silindi');
  await C.goto(B + '/giris'); await C.fill('[name=email]', 'cem@test.com'); await C.fill('[name=password]', 'sifre12345');
  await C.click('form.kart-form button.tam'); await C.waitForLoadState();
  ok((await C.content()).includes('hatalı'), 'silinen hesapla giriş yapılamıyor');

  // ---- Google butonu (ayarlı değilken gizli) ----
  ok(await C.locator('.google-btn').count() === 0, 'Google anahtarı yokken Google butonu gizli');

  ok(errs.length === 0, 'JS hatası yok ' + errs.join(' | '));
  await br.close();
})();
