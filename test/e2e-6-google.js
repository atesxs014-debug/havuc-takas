// env: {"GOOGLE_CLIENT_ID": "test-istemci.apps.googleusercontent.com", "GOOGLE_CLIENT_SECRET": "test-gizli"}
// Google ile giriş: buton ve yönlendirme (Google'ın kendisine bağlanmadan)
const { chromium } = require('playwright');
const { B, ok } = require('./helpers');

(async () => {
  const br = await chromium.launch();
  const p = await br.newPage();
  await p.goto(B + '/giris?next=/ilan-ver');
  ok(await p.locator('.google-btn').count() === 1, 'giriş sayfasında "Google ile devam et" var');
  await p.goto(B + '/kayit');
  ok(await p.locator('.google-btn').count() === 1, 'kayıt sayfasında "Google ile devam et" var');
  const r = await fetch(B + '/giris/google?next=/ilan-ver', { redirect: 'manual' });
  const loc = new URL(r.headers.get('location'));
  ok(r.status === 302 && loc.host === 'accounts.google.com', 'Google giriş sayfasına yönlendiriyor');
  ok(loc.searchParams.get('client_id') === 'test-istemci.apps.googleusercontent.com' && loc.searchParams.get('scope') === 'openid email profile'
    && loc.searchParams.get('redirect_uri').endsWith('/giris/google/donus') && loc.searchParams.get('state').length === 32, 'yönlendirme parametreleri doğru');
  const d = await fetch(B + '/giris/google/donus?code=x&state=sahte', { redirect: 'manual' });
  ok(d.status === 302 && d.headers.get('location') === '/giris', 'sahte "state" ile dönüş reddediliyor');
  await br.close();
})();
