// Yönetim paneli yardımcıları: işlem kaydı, özet ekranı, reklam alanı doluluğu, sistem durumu, CSV
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const config = require('./config');
const { iller } = require('./locations');
const { SLOT_SAYISI } = require('./ads');

// ---- İşlem kaydı ----
const insLog = db.prepare('INSERT INTO admin_log (admin_id, admin_name, action, detail, ip) VALUES (?, ?, ?, ?, ?)');
function kaydet(req, action, detail) {
  try {
    insLog.run(req.user ? req.user.id : null, req.user ? req.user.name : null, String(action).slice(0, 120),
      detail ? String(detail).slice(0, 500) : null, (req.ip || '').slice(0, 64));
  } catch (e) { console.error('işlem kaydı yazılamadı:', e.message); }
}

// POST yollarından okunur işlem adı
const EYLEMLER = [
  [/^\/reklam\/\d+\/onayla$/, 'Reklam yayına alındı'],
  [/^\/reklam\/\d+\/reddet$/, 'Reklam başvurusu reddedildi'],
  [/^\/reklam\/\d+\/durdur$/, 'Reklam yayından kaldırıldı'],
  [/^\/reklam\/\d+\/uzat$/, 'Reklam süresi uzatıldı'],
  [/^\/reklam\/\d+\/uzatma-iptal$/, 'Uzatma talebi silindi'],
  [/^\/uye\/\d+\/engelle$/, 'Üye engellendi'],
  [/^\/uye\/\d+\/engel-kaldir$/, 'Üye engeli kaldırıldı'],
  [/^\/iletisim\/\d+\/kapat$/, 'İletişim mesajı kapatıldı'],
  [/^\/sikayet\/toplu$/, 'Şikayetler toplu kapatıldı'],
  [/^\/sikayet\/\d+\/kapat$/, 'Şikayet kapatıldı'],
  [/^\/ilan\/toplu$/, 'İlanlar toplu güncellendi'],
  [/^\/ilan\/\d+\/durum$/, 'İlan durumu değişti'],
  [/^\/siparis\/\d+\/aktar$/, 'Sipariş ödemesi satıcıya aktarıldı'],
  [/^\/siparis\/\d+\/iade$/, 'Sipariş alıcıya iade edildi'],
  [/^\/fiyatlar$/, 'Reklam fiyatları güncellendi'],
  [/^\/fiyatlar\/ozel$/, 'Özel reklam fiyatı kaydedildi'],
  [/^\/kelimeler$/, 'Yasaklı kelimeler güncellendi'],
  [/^\/yedek$/, 'Elle yedek alındı'],
];
function eylemAdi(p) {
  const e = EYLEMLER.find(([re]) => re.test(p));
  return e ? e[1] : 'İşlem: ' + p;
}

// Her yönetim POST'u bittiğinde, ekrana yazılan sonuç mesajıyla birlikte kaydedilir
function kayitAraKatmani(req, res, next) {
  if (req.method !== 'POST') return next();
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    const f = req.session && req.session.flash;
    const hedef = req.params && req.params.id ? `#${req.params.id}` : '';
    kaydet(req, eylemAdi(req.path), [hedef, f && f.text].filter(Boolean).join(' · '));
  });
  next();
}

const LOG_SAYFA = 50;
function kayitlar({ q = '', sayfa = 1 } = {}) {
  const like = '%' + q.toLowerCase() + '%';
  const where = q ? 'WHERE lower(action) LIKE ? OR lower(COALESCE(detail, \'\')) LIKE ? OR lower(COALESCE(admin_name, \'\')) LIKE ?' : '';
  const args = q ? [like, like, like] : [];
  const toplam = db.prepare(`SELECT COUNT(*) AS n FROM admin_log ${where}`).get(...args).n;
  const rows = db.prepare(`SELECT * FROM admin_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, LOG_SAYFA, (sayfa - 1) * LOG_SAYFA);
  return { rows, toplam, sayfaSayisi: Math.max(1, Math.ceil(toplam / LOG_SAYFA)) };
}

// ---- Reklam alanı doluluğu (her il ve ilçede 4 alan) ----
function alanDoluluk() {
  const aktif = db.prepare("SELECT il, ilce, COUNT(*) AS n FROM ads WHERE status = 'active' GROUP BY il, ilce").all();
  const bekleyen = db.prepare("SELECT il, COUNT(*) AS n FROM ads WHERE status = 'pending' GROUP BY il").all();
  const ilDolu = new Map(), ilGenel = new Map(), bek = new Map(bekleyen.map((r) => [r.il, r.n]));
  for (const r of aktif) {
    ilDolu.set(r.il, (ilDolu.get(r.il) || 0) + r.n);
    if (!r.ilce) ilGenel.set(r.il, r.n);
  }
  const satirlar = iller.map((il) => {
    const toplam = (il.ilceler.length + 1) * SLOT_SAYISI;
    const dolu = ilDolu.get(il.slug) || 0;
    return { slug: il.slug, ad: il.ad, plaka: il.plaka, ilce: il.ilceler.length, toplam, dolu,
      ilGenel: ilGenel.get(il.slug) || 0, bekleyen: bek.get(il.slug) || 0, oran: toplam ? dolu / toplam : 0 };
  });
  const toplam = satirlar.reduce((t, r) => t + r.toplam, 0);
  const dolu = satirlar.reduce((t, r) => t + r.dolu, 0);
  return { satirlar, toplam, dolu, oran: toplam ? dolu / toplam : 0 };
}

// ---- Özet ekranı ----
function ozet() {
  const s = db.prepare(`SELECT
    (SELECT COUNT(*) FROM users) AS uye,
    (SELECT COUNT(*) FROM users WHERE created_at >= datetime('now', '-7 days')) AS uye7,
    (SELECT COUNT(*) FROM listings WHERE status = 'active') AS ilan,
    (SELECT COUNT(*) FROM listings WHERE created_at >= datetime('now', '-7 days')) AS ilan7,
    (SELECT COUNT(*) FROM messages WHERE created_at >= datetime('now', '-7 days')) AS mesaj7,
    (SELECT COUNT(*) FROM ads WHERE status = 'active') AS reklam,
    (SELECT COALESCE(SUM(price), 0) FROM ads WHERE paid = 1 AND price IS NOT NULL AND start_date >= date('now', 'start of month')) AS gelirAy,
    (SELECT COALESCE(SUM(price), 0) FROM ads WHERE paid = 1 AND price IS NOT NULL) AS gelirToplam,
    (SELECT COALESCE(SUM(impressions), 0) FROM ads WHERE status = 'active') AS gosterim,
    (SELECT COALESCE(SUM(clicks), 0) FROM ads WHERE status = 'active') AS tiklama,
    (SELECT COUNT(*) FROM ads WHERE status = 'active' AND end_date <= date('now', '+7 days')) AS bitecek`).get();
  const sonUyeler = db.prepare('SELECT id, name, email, created_at, email_verified FROM users ORDER BY id DESC LIMIT 6').all();
  const sonIlanlar = db.prepare('SELECT id, title, il, ilce, status, price, is_swap, created_at FROM listings ORDER BY id DESC LIMIT 6').all();
  const bitecekler = db.prepare(`SELECT id, business_name, il, ilce, end_date, renew_months FROM ads
    WHERE status = 'active' AND end_date <= date('now', '+7 days') ORDER BY end_date LIMIT 6`).all();
  return { s, sonUyeler, sonIlanlar, bitecekler, sonKayit: kayitlar({}).rows.slice(0, 8), alan: alanDoluluk() };
}

// ---- Sistem durumu (gizli değerleri göstermez, yalnızca "ayarlı mı") ----
const BASLANGIC = Date.now();
function klasorBoyutu(dir, sinir = 20000) {
  let n = 0, boyut = 0;
  const yigin = [dir];
  try {
    while (yigin.length && n < sinir) {
      const d = yigin.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) yigin.push(p);
        else if (e.isFile()) { n++; boyut += fs.statSync(p).size; }
      }
    }
  } catch {}
  return { n, boyut, eksik: n >= sinir };
}
function sistem() {
  const dbYol = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'havuc.db');
  const dbBoyut = (() => { try { return fs.statSync(dbYol).size + (fs.existsSync(dbYol + '-wal') ? fs.statSync(dbYol + '-wal').size : 0); } catch { return 0; } })();
  const uploads = klasorBoyutu(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));
  let sonYedek = null;
  try {
    const f = fs.readdirSync(config.backup.dir).filter((x) => x.endsWith('.db')).sort().pop();
    if (f) sonYedek = { f, t: fs.statSync(path.join(config.backup.dir, f)).mtime.toISOString() };
  } catch {}
  const kvkkTam = !!(config.kvkk.unvan && config.kvkk.adres && config.kvkk.eposta);
  const kontroller = [
    { ad: 'Yönetici e-postası (ADMIN_EMAIL)', ok: !!config.ADMIN_EMAIL, not: config.ADMIN_EMAIL ? 'Ayarlı' : 'Boş: siteye ilk kayıt olan hesap yönetici olur' },
    { ad: 'Site adresi (SITE_URL)', ok: !!config.SITE_URL, not: config.SITE_URL || 'Boş: e-posta bağlantıları istek adresinden üretilir', uyari: !config.SITE_URL },
    { ad: 'E-posta gönderimi (SMTP)', ok: !!config.smtp, not: config.smtp ? config.smtp.host : 'Kapalı: e-postalar yalnızca konsola yazılır', uyari: !config.smtp },
    { ad: 'Bot koruması (Turnstile)', ok: !!config.turnstile, not: config.turnstile ? 'Açık' : 'Kapalı', uyari: !config.turnstile },
    { ad: 'KVKK veri sorumlusu bilgileri', ok: kvkkTam, not: kvkkTam ? 'Tam' : 'KVKK_UNVAN / KVKK_ADRES / KVKK_EPOSTA eksik', uyari: !kvkkTam },
    { ad: 'Reklam ödemesi IBAN (BANK_IBAN)', ok: !!config.bank.iban, not: config.bank.iban ? 'Ayarlı' : 'Boş: işletmeler ödeme bilgisini göremez', uyari: !config.bank.iban },
    { ad: 'Google ile giriş', ok: !!config.google, not: config.google ? 'Açık' : 'Kapalı (isteğe bağlı)', uyari: false, istege: true },
    { ad: 'Kargolu satış (iyzico)', ok: !!config.iyzico, not: config.iyzico ? 'Açık' : config.KARGO_TEST ? 'Test modu (gerçek para yok)' : 'Kapalı', uyari: false, istege: true },
    { ad: 'Otomatik yedek', ok: config.backup.enabled, not: config.backup.enabled ? `Açık · ${config.backup.keepDays} gün saklanır` : 'Kapalı', uyari: !config.backup.enabled },
    { ad: 'Çalışma modu', ok: config.PROD, not: config.PROD ? 'Canlı (production)' : 'Geliştirme', uyari: false, istege: true },
  ];
  return {
    node: process.version, calisma: Date.now() - BASLANGIC, bellek: process.memoryUsage().rss,
    dbBoyut, uploads, sonYedek, kontroller,
    surum: db.prepare('PRAGMA user_version').get().user_version,
  };
}

// ---- CSV (Excel Türkçe karakterleri doğru açsın diye BOM + noktalı virgül) ----
function csv(basliklar, satirlar) {
  const h = (v) => {
    if (v == null) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // formül enjeksiyonuna karşı
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + [basliklar, ...satirlar].map((r) => r.map(h).join(';')).join('\r\n');
}

module.exports = { kaydet, kayitAraKatmani, kayitlar, alanDoluluk, ozet, sistem, csv, LOG_SAYFA };
