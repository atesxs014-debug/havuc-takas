// Site içi bildirimler (zil) + kayıtlı aramalar
const db = require('./db');
const config = require('./config');
const { send } = require('./mail');
const { konumAdi } = require('./locations');

const base = () => config.SITE_URL || `http://localhost:${config.PORT}`;

const ins = db.prepare('INSERT INTO notifications (user_id, icon, text, url) VALUES (?, ?, ?, ?)');
const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL');
const list = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100');
const markAll = db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL");
const prune = db.prepare("DELETE FROM notifications WHERE created_at < datetime('now', '-90 days')");

/** Kullanıcıya zil bildirimi ekler */
function ekle(userId, text, url = null, icon = '🔔') {
  if (!userId) return;
  ins.run(userId, icon, String(text).slice(0, 300), url);
}

// ---- Kayıtlı aramalar ----
const ARAMA_SINIRI = 20;
const searchesFor = db.prepare('SELECT * FROM saved_searches WHERE user_id = ? ORDER BY id DESC');
const insSearch = db.prepare(`INSERT INTO saved_searches (user_id, q, il, ilce, kategori, tip, durum, fmin, fmax)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const sameSearch = db.prepare(`SELECT id FROM saved_searches WHERE user_id = ? AND q = ? AND il = ? AND ilce = ? AND kategori = ?
  AND tip = ? AND durum = ? AND fmin IS ? AND fmax IS ?`);
const allSearches = db.prepare('SELECT * FROM saved_searches WHERE user_id != ?');
const bump = db.prepare('UPDATE saved_searches SET pending = pending + 1 WHERE id = ?');

function aramaKaydet(userId, f) {
  const v = [f.q || '', f.il || '', f.ilce || '', f.kategori || '', f.tip || '', f.durum || '', f.fmin ?? null, f.fmax ?? null];
  if (sameSearch.get(userId, ...v)) return 'var';
  if (searchesFor.all(userId).length >= ARAMA_SINIRI) return 'sinir';
  insSearch.run(userId, ...v);
  return 'ok';
}

/** Kayıtlı aramanın okunur özeti: "bisiklet · İzmir / Buca · 500–2.000 TL" */
function aramaAdi(s) {
  const { getKategori } = require('./categories');
  const tl = (n) => new Intl.NumberFormat('tr-TR').format(n);
  const p = [];
  if (s.q) p.push(`"${s.q}"`);
  if (s.kategori) p.push(getKategori(s.kategori).ad);
  p.push(s.il ? konumAdi(s.il, s.ilce || '') : 'Tüm Türkiye');
  if (s.tip) p.push(s.tip === 'takas' ? 'Takaslık' : 'Satılık');
  if (s.durum) p.push(require('./durum').DURUM_AD[s.durum] || s.durum);
  if (s.fmin != null || s.fmax != null) p.push(`${s.fmin != null ? tl(s.fmin) : '0'}–${s.fmax != null ? tl(s.fmax) + ' TL' : '∞'}`);
  return p.join(' · ');
}

function aramaUrl(s) {
  const o = { q: s.q, il: s.il, ilce: s.ilce, kategori: s.kategori, tip: s.tip, durum: s.durum, fmin: s.fmin, fmax: s.fmax };
  return '/ilanlar?' + Object.keys(o).filter((k) => o[k] != null && o[k] !== '').map((k) => `${k}=${encodeURIComponent(o[k])}`).join('&');
}

function eslesir(s, l) {
  if (s.il && s.il !== l.il) return false;
  if (s.ilce && s.ilce !== l.ilce) return false;
  if (s.kategori && s.kategori !== l.category) return false;
  if (s.tip === 'satilik' && l.price == null) return false;
  if (s.tip === 'takas' && !l.is_swap) return false;
  if (s.durum && s.durum !== l.condition) return false;
  if (s.fmin != null && (l.price == null || l.price < s.fmin)) return false;
  if (s.fmax != null && (l.price == null || l.price > s.fmax)) return false;
  if (s.q) {
    const metin = db.arama(l.title + ' ' + l.description);
    if (!db.arama(s.q).split(/\s+/).filter(Boolean).every((w) => metin.includes(w))) return false;
  }
  return true;
}

/** Yeni yayına giren ilan için kayıtlı aramalara bildirim (zil hemen, e-posta günlük özet) */
function yeniIlan(l) {
  if (!l || l.status !== 'active') return 0;
  const engel = require('./engel');
  let n = 0;
  const gorulen = new Set();
  for (const s of allSearches.all(l.user_id)) {
    if (gorulen.has(s.user_id) || !eslesir(s, l) || engel.arasinda(s.user_id, l.user_id)) continue;
    gorulen.add(s.user_id);
    ekle(s.user_id, `Kayıtlı aramana uyan yeni ilan: ${l.title}`, `/ilan/${l.id}`, '🔎');
    bump.run(s.id);
    n++;
  }
  return n;
}

/** Günde bir: bekleyen eşleşmeleri olan aramalar için e-posta özeti */
function gunlukOzet() {
  const rows = db.prepare(`SELECT s.*, u.email, u.name, u.notify_email FROM saved_searches s JOIN users u ON u.id = s.user_id
    WHERE s.pending > 0`).all();
  const kisi = new Map();
  for (const r of rows) {
    if (!kisi.has(r.user_id)) kisi.set(r.user_id, { email: r.email, name: r.name, ok: r.notify_email, items: [] });
    kisi.get(r.user_id).items.push(r);
  }
  for (const k of kisi.values()) {
    if (k.ok) {
      send({
        to: k.email,
        subject: '🔎 Kayıtlı aramalarına uyan yeni ilanlar var',
        title: `Merhaba ${k.name.split(' ')[0]}, aradıkların ilana çıktı`,
        lines: k.items.map((s) => `${aramaAdi(s)}: ${s.pending} yeni ilan — ${base()}${aramaUrl(s)}`),
        button: { text: 'Aramalarımı gör', url: `${base()}/aramalarim` },
      });
    }
  }
  db.prepare("UPDATE saved_searches SET pending = 0, emailed_at = datetime('now') WHERE pending > 0").run();
  prune.run();
  return kisi.size;
}

module.exports = {
  ekle, okunmamis: (uid) => unread.get(uid).n, liste: (uid) => list.all(uid), hepsiOkundu: (uid) => markAll.run(uid),
  aramaKaydet, aramalar: (uid) => searchesFor.all(uid), aramaAdi, aramaUrl, eslesir, yeniIlan, gunlukOzet, ARAMA_SINIRI,
};
