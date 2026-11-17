// Günlük otomatik yedek: veritabanı (VACUUM INTO) + yeni fotoğraflar. Eski yedekler silinir.
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const config = require('./config');
const { UPLOAD_DIR } = require('./images');

function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }); // YYYY-MM-DD
}

function run({ force = false } = {}) {
  const dir = config.backup.dir;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `havuc-${today()}.db`);
  if (fs.existsSync(file) && !force) return null;
  if (fs.existsSync(file)) fs.unlinkSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);

  // Fotoğraflar: sadece yedekte olmayanlar kopyalanır (artımlı)
  const up = path.join(dir, 'uploads');
  fs.mkdirSync(up, { recursive: true });
  let kopya = 0;
  for (const f of fs.readdirSync(UPLOAD_DIR)) {
    const dst = path.join(up, f);
    if (f.startsWith('.') || fs.existsSync(dst)) continue;
    fs.copyFileSync(path.join(UPLOAD_DIR, f), dst);
    kopya++;
  }

  // Eski veritabanı yedeklerini temizle
  const keep = config.backup.keepDays;
  const dbs = fs.readdirSync(dir).filter((f) => /^havuc-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  for (const old of dbs.slice(0, Math.max(0, dbs.length - keep))) fs.unlinkSync(path.join(dir, old));

  console.log(`💾 Yedek alındı: ${file} (+${kopya} fotoğraf)`);
  return file;
}

module.exports = { run };
