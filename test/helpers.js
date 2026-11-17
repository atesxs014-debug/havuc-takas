// Testlerde ortak yardımcılar. test/run.js her test için ayrı veritabanı, klasör ve port hazırlar.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const B = process.env.BASE_URL || 'http://localhost:3100';
const DATA = path.dirname(process.env.DB_PATH || path.join(ROOT, 'data', 'havuc.db'));
const MAILS = path.join(DATA, 'epostalar');
const UPLOADS = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');
const SHOTS = process.env.SCREENSHOT_DIR || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let fails = 0;
const ok = (c, msg) => { console.log((c ? '✅' : '❌') + ' ' + msg); if (!c) { fails++; process.exitCode = 1; } };

/** Sunucuyla aynı veritabanında SQL çalıştırır (SELECT → satırlar JSON, diğerleri → sonuç) */
const sql = (q, ...params) => execFileSync(process.execPath, ['--no-warnings', '-e',
  `const db=require('./lib/db');const q=process.argv[1];const p=JSON.parse(process.argv[2]);
   console.log(JSON.stringify(/^\\s*SELECT/i.test(q)?db.prepare(q).all(...p):db.prepare(q).run(...p)))`, q, JSON.stringify(params)],
{ cwd: ROOT, env: process.env }).toString().trim();

/** Uygulama kodunu sunucuyla aynı veritabanında çalıştırır (ör. zamanlanmış görevler) */
const run = (code) => execFileSync(process.execPath, ['--no-warnings', '-e', code], { cwd: ROOT, env: process.env }).toString().trim();

const mails = (to) => (fs.existsSync(MAILS) ? fs.readdirSync(MAILS).filter((x) => x.includes(to.replace(/[^a-z0-9@.]/gi, '_'))).sort() : [])
  .map((f) => fs.readFileSync(path.join(MAILS, f), 'utf8'));
const lastLink = (to, re) => { const m = (mails(to).pop() || '').match(re); return m && m[0]; };

/** Ekran görüntüsü: yalnızca SCREENSHOT_DIR verilmişse */
const shot = (page, name, opts = {}) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, name), fullPage: true, ...opts }) : Promise.resolve());

module.exports = { ROOT, B, DATA, MAILS, UPLOADS, ok, sql, run, mails, lastLink, shot };
