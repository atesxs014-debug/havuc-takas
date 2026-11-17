// Kademeli reklam fiyatları: il grubuna (3 büyük şehir / diğer büyükşehirler / diğer iller)
// ve reklam türüne (il geneli / ilçe) göre aylık fiyat. Tek tek il/ilçe için özel fiyat da girilebilir.
const db = require('./db');
const { getIl, getIlce } = require('./locations');

const UC_BUYUK = new Set(['istanbul', 'ankara', 'izmir']);
const BUYUKSEHIR = new Set(['adana', 'antalya', 'aydin', 'balikesir', 'bursa', 'denizli', 'diyarbakir', 'erzurum',
  'eskisehir', 'gaziantep', 'hatay', 'kahramanmaras', 'kayseri', 'kocaeli', 'konya', 'malatya', 'manisa', 'mardin',
  'mersin', 'mugla', 'ordu', 'sakarya', 'samsun', 'sanliurfa', 'tekirdag', 'trabzon', 'van']);

const GRUPLAR = [
  { key: 'buyuk3', ad: 'İstanbul, Ankara, İzmir' },
  { key: 'buyuksehir', ad: 'Diğer 27 büyükşehir' },
  { key: 'diger', ad: 'Diğer 51 il' },
];
const SURE_INDIRIM = { 1: 0, 3: 0, 6: 0, 12: 0 }; // kademeli seçildi; süre indirimi yok

const grup = (il) => (UC_BUYUK.has(il) ? 'buyuk3' : BUYUKSEHIR.has(il) ? 'buyuksehir' : 'diger');
const settingKey = (tur, g) => `price_${tur}_${g}`;

function tablo() {
  const t = {};
  for (const g of GRUPLAR) {
    t[g.key] = {
      il: parseInt(db.setting(settingKey('il', g.key)), 10) || null,
      ilce: parseInt(db.setting(settingKey('ilce', g.key)), 10) || null,
    };
  }
  return t;
}

function setTablo(values) {
  for (const g of GRUPLAR) for (const tur of ['il', 'ilce']) {
    const v = parseInt(String(values[`${tur}_${g.key}`] || '').replace(/[^\d]/g, ''), 10);
    db.setSetting(settingKey(tur, g.key), v > 0 ? v : null);
  }
}

const getOverride = db.prepare('SELECT price FROM price_overrides WHERE il = ? AND ilce = ?');

/** Aylık fiyat (TL) — null ise fiyat girilmemiş */
function aylik(il, ilce = '') {
  const o = getOverride.get(il, ilce || '');
  if (o) return o.price;
  return tablo()[grup(il)][ilce ? 'ilce' : 'il'];
}

function toplam(il, ilce, months) {
  const a = aylik(il, ilce);
  return a == null ? null : Math.round(a * months * (1 - (SURE_INDIRIM[months] || 0)));
}

const overrides = () => db.prepare('SELECT * FROM price_overrides ORDER BY il, ilce').all();
function setOverride(il, ilce, price) {
  if (!getIl(il) || (ilce && !getIlce(il, ilce))) return false;
  const p = parseInt(String(price).replace(/[^\d]/g, ''), 10);
  if (p > 0) db.prepare('INSERT INTO price_overrides (il, ilce, price) VALUES (?, ?, ?) ON CONFLICT(il, ilce) DO UPDATE SET price = excluded.price').run(il, ilce || '', p);
  else db.prepare('DELETE FROM price_overrides WHERE il = ? AND ilce = ?').run(il, ilce || '');
  return true;
}

module.exports = { GRUPLAR, grup, tablo, setTablo, aylik, toplam, overrides, setOverride };
