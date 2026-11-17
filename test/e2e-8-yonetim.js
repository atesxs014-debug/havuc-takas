// env: {"PUSH_DISABLED": "1", "ADMIN_EMAIL": "admin@test.com"}
// Yeni yönetim paneli: özet, yan menü, toplu işlem, arama/filtre, işlem kaydı, Excel'e aktarma, alan doluluğu, sistem durumu, yetki
const fs = require('node:fs');
const { chromium } = require('playwright');
const { B, ok, sql } = require('./helpers');

(async () => {
  const br = await chromium.launch(); const errs = []; const cspHata = [];
  const mk = async (w = 1280) => {
    const c = await br.newContext({ viewport: { width: w, height: 900 }, acceptDownloads: true });
    const p = await c.newPage();
    p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
    p.on('console', (m) => { if (/Content Security Policy|Refused to/.test(m.text())) cspHata.push(m.text()); });
    return p;
  };
  const A = await mk(), S = await mk(), T = await mk(390);
  const register = async (p, name, email) => {
    await p.goto(B + '/kayit'); await p.fill('[name=name]', name); await p.fill('[name=email]', email);
    await p.fill('[name=password]', 'sifre12345'); await p.fill('[name=password2]', 'sifre12345'); await p.check('[name=kvkk]');
    await Promise.all([p.waitForNavigation(), p.click('form.kart-form button.tam')]);
  };
  const flash = async (p) => (await p.locator('.flash').first().textContent().catch(() => '')) || '';

  await register(A, 'Yönetici Ates', 'admin@test.com');
  await register(S, 'Satıcı Selin', 'selin@test.com');
  const sid = JSON.parse(sql("SELECT id FROM users WHERE email = 'selin@test.com'"))[0].id;
  for (let i = 1; i <= 4; i++) {
    sql(`INSERT INTO listings (user_id, title, description, category, price, il, ilce, status, mod_reason)
      VALUES (?, ?, 'Temiz ürün', 'spor-outdoor', ?, 'izmir', 'buca', ?, ?)`, sid, `Test Ürünü ${i}`, i * 100, i <= 2 ? 'pending' : 'active', i <= 2 ? 'kapora' : null);
  }
  const ilanlar = JSON.parse(sql('SELECT id, status FROM listings ORDER BY id'));
  sql("INSERT INTO reports (listing_id, reason) VALUES (?, 'Şüpheli'), (?, 'Sahte')", ilanlar[2].id, ilanlar[3].id);

  // ---- Yetki ----
  const r = await S.goto(B + '/yonetim');
  ok(r.status() === 403 || S.url().includes('/giris') || !(await S.content()).includes('yp-yan'), 'yönetici olmayan paneli açamıyor');
  const csv = await S.request.get(B + '/yonetim/disa-aktar/uyeler', { maxRedirects: 0 });
  ok(csv.status() !== 200 || !(await csv.text()).includes('admin@test.com'), 'yönetici olmayan üye listesini indiremiyor');

  // ---- Özet ve yerleşim ----
  await A.goto(B + '/yonetim');
  ok(await A.locator('.yp-yan .yp-link.aktif', { hasText: 'Özet' }).count() === 1, 'panel varsayılan olarak Özet ekranıyla açılıyor');
  ok(await A.locator('.yp-kpi').count() === 6, 'özette 6 gösterge kartı var');
  ok((await A.locator('.yp-isler').textContent()).includes('Onay bekleyen ilan'), 'yapılacaklar listesinde onay bekleyen ilan var');
  ok((await A.locator('.yp-kpi', { hasText: 'Reklam alanı doluluğu' }).textContent()).includes('4.216'), 'toplam reklam alanı 4.216 (81 il + 973 ilçe × 4)');
  const blur = await A.locator('.yp-ust').evaluate((e) => getComputedStyle(e).backdropFilter || getComputedStyle(e).webkitBackdropFilter);
  ok(/blur/.test(blur), `üst çubuk cam efektli (${blur})`);
  ok(await A.locator('.yp-yan').evaluate((e) => getComputedStyle(e).position) === 'fixed', 'yan menü sabit');

  // ---- Tema ----
  const tema = () => A.evaluate(() => document.documentElement.getAttribute('data-tema') || 'koyu');
  const ilkTema = await tema();
  await A.click('#ypTema');
  const yeniTema = await tema();
  ok(yeniTema !== ilkTema, `tema düğmesi temayı değiştiriyor (${ilkTema} → ${yeniTema})`);
  await A.reload();
  ok(await tema() === yeniTema, 'seçilen tema hatırlanıyor');

  // ---- Hızlı geçiş (Ctrl+K) ----
  await A.keyboard.press('Control+k');
  ok(await A.locator('#ypPalet[open]').count() === 1, 'Ctrl+K hızlı geçiş penceresini açıyor');
  await A.keyboard.type('sikayet');
  await Promise.all([A.waitForNavigation(), A.keyboard.press('Enter')]);
  ok(A.url().includes('tab=sikayet'), 'hızlı geçişte "sikayet" yazıp Enter → Şikayetler (Türkçe harf duyarsız)');

  // ---- Toplu işlemler ----
  ok(await A.locator('[data-toplu-btn]').first().isDisabled(), 'hiçbir şey seçilmeden toplu buton kapalı');
  await A.check('#topluSikayet [data-hepsini-sec]');
  ok((await A.locator('#topluSikayet [data-secili-sayi]').textContent()).includes('2'), 'hepsini seç 2 şikayeti seçti');
  await Promise.all([A.waitForNavigation(), A.click('#topluSikayet button:has-text("kapat")')]);
  ok((await flash(A)).includes('2 şikayet kapatıldı'), 'şikayetler toplu kapatıldı');

  await A.goto(B + '/yonetim?tab=onay');
  await A.check('#topluOnay [data-hepsini-sec]');
  await Promise.all([A.waitForNavigation(), A.click('#topluOnay button[value=active]')]);
  ok((await flash(A)).includes('2 ilan yayına alındı'), 'onay bekleyen ilanlar toplu yayınlandı');
  ok(JSON.parse(sql("SELECT COUNT(*) AS n FROM listings WHERE status = 'active' AND expires_at IS NOT NULL AND id IN (?, ?)", ilanlar[0].id, ilanlar[1].id))[0].n === 2, 'toplu onayda ilan süresi de başladı');

  // ---- Arama, filtre, filtreyi koruyarak işlem ----
  await A.goto(B + '/yonetim?tab=ilan&q=' + encodeURIComponent('ürünü 3'));
  ok(await A.locator('.tablo tbody tr').count() === 1, 'ilan aramada Türkçe harf duyarsız eşleşme (ürünü 3)');
  await A.goto(B + '/yonetim?tab=ilan&durum=active&q=test');
  await A.locator('.tablo tbody tr').first().locator('input[name=ids]').check();
  await Promise.all([A.waitForNavigation(), A.click('#topluIlan button[value=removed]')]);
  ok(A.url().includes('durum=active') && A.url().includes('q=test'), 'toplu işlemden sonra arama ve filtre korunuyor');
  ok((await flash(A)).includes('1 ilan kaldırıldı'), 'seçilen ilan toplu kaldırıldı');
  await A.goto(B + '/yonetim?tab=uye&filtre=yonetici');
  ok(await A.locator('.tablo tbody tr').count() === 1 && (await A.locator('.tablo').textContent()).includes('admin@test.com'), 'üye filtresi: yalnızca yöneticiler');

  // ---- İşlem kaydı ----
  await A.goto(B + '/yonetim?tab=kayit');
  const kayit = await A.locator('.tablo').textContent();
  ok(kayit.includes('Şikayetler toplu kapatıldı') && kayit.includes('İlanlar toplu güncellendi') && kayit.includes('Yönetici Ates'), 'yapılan işlemler kim yaptıysa adıyla kaydedildi');
  await A.goto(B + '/yonetim');
  ok(await A.locator('.yp-panel', { hasText: 'Son işlemler' }).locator('li').count() >= 3, 'özette son işlemler görünüyor');

  // ---- Excel'e aktarma ----
  await A.goto(B + '/yonetim?tab=uye');
  const [dl] = await Promise.all([A.waitForEvent('download'), A.click('a[href="/yonetim/disa-aktar/uyeler"]')]);
  const icerik = fs.readFileSync(await dl.path(), 'utf8');
  ok(icerik.charCodeAt(0) === 0xfeff && icerik.includes('Satıcı Selin') && icerik.includes(';'), 'üyeler Excel uyumlu CSV olarak indi (Türkçe karakterler korunuyor)');
  sql("UPDATE users SET name = '=HYPERLINK(1)' WHERE id = ?", sid);
  const csv2 = await (await A.request.get(B + '/yonetim/disa-aktar/uyeler')).text();
  ok(csv2.includes("'=HYPERLINK") && !csv2.includes(';=HYPERLINK'), 'CSV formül enjeksiyonuna karşı korunuyor');

  // ---- Alan doluluğu ve sistem ----
  await A.goto(B + '/yonetim?tab=alanlar');
  ok(await A.locator('#alanTablo tbody tr').count() === 81, 'alan doluluğu tablosunda 81 il');
  await A.fill('[data-tablo-suz]', 'izm');
  ok(await A.locator('#alanTablo tbody tr:visible').count() === 1, 'il araması tabloyu süzüyor');
  await A.goto(B + '/yonetim?tab=sistem');
  const sis = await A.content();
  ok(sis.includes('Ayar kontrolü') && sis.includes('KVKK') && !sis.includes(process.env.SESSION_SECRET || '__yok__'), 'sistem durumu ayarları gösteriyor, gizli değer göstermiyor');

  // ---- Telefon ----
  await T.goto(B + '/giris'); await T.fill('[name=email]', 'admin@test.com'); await T.fill('[name=password]', 'sifre12345');
  await Promise.all([T.waitForNavigation(), T.click('form.kart-form button.tam')]);
  for (const t of ['ozet', 'ilan', 'uye', 'alanlar', 'sistem']) {
    await T.goto(B + '/yonetim?tab=' + t);
    const tasma = await T.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(tasma <= 1, `telefonda ${t} sayfası yatay taşmıyor`);
  }
  ok(!(await T.locator('.yp-yan').isVisible()) || (await T.locator('.yp-yan').boundingBox()).x < 0, 'telefonda yan menü kapalı başlıyor');
  await T.click('#ypMenu');
  const acildi = await T.waitForFunction(() => document.getElementById('ypYan').getBoundingClientRect().left >= 0, null, { timeout: 3000 }).then(() => true, () => false);
  ok(acildi && await T.locator('.yp-yan.acik').count() === 1, 'menü düğmesi yan menüyü açıyor');

  ok(!cspHata.length, 'hiçbir sayfada CSP engeli yok' + (cspHata.length ? ': ' + cspHata[0] : ''));
  ok(!errs.length, 'tarayıcıda JavaScript hatası yok' + (errs.length ? ': ' + errs[0] : ''));
  await br.close();
})();
