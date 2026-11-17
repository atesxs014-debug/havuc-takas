// Uçtan uca testleri çalıştırır: her test dosyası için boş bir veritabanı + klasör + sunucu açar.
// Kullanım: npm test            (hepsi)
//           npm test -- kargo   (adında "kargo" geçenler)
// Ekran görüntüsü için: SCREENSHOT_DIR=/bir/klasor npm test
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const filtre = process.argv.slice(2);
const dosyalar = fs.readdirSync(__dirname).filter((f) => /^e2e-.*\.js$/.test(f)).sort()
  .filter((f) => !filtre.length || filtre.some((x) => f.includes(x)));

const bekle = (port, ms = 15000) => new Promise((resolve, reject) => {
  const bitis = Date.now() + ms;
  (function dene() {
    const s = net.connect(port, '127.0.0.1', () => { s.end(); resolve(); });
    s.on('error', () => (Date.now() > bitis ? reject(new Error('Sunucu açılmadı')) : setTimeout(dene, 150)));
  })();
});

(async () => {
  let basarisiz = 0;
  for (const [i, f] of dosyalar.entries()) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'havuc-test-'));
    const port = 3200 + i;
    const ilk = fs.readFileSync(path.join(__dirname, f), 'utf8').split('\n')[0];
    const ekEnv = ilk.startsWith('// env:') ? JSON.parse(ilk.slice(7)) : {};
    const env = {
      ...process.env, NODE_ENV: 'test', PORT: String(port), BASE_URL: `http://localhost:${port}`,
      DB_PATH: path.join(dir, 'havuc.db'), UPLOAD_DIR: path.join(dir, 'uploads'), BACKUP_DISABLED: '1',
      SESSION_SECRET: 'test-secret-' + i, KARGO_TEST_MODE: '1', ...ekEnv,
    };
    console.log(`\n▶ ${f}`);
    spawnSync(process.execPath, ['--no-warnings', 'scripts/seed.js'], { cwd: ROOT, env, stdio: 'ignore' });
    const log = fs.openSync(path.join(dir, 'sunucu.log'), 'w');
    const srv = spawn(process.execPath, ['--no-warnings', 'server.js'], { cwd: ROOT, env, stdio: ['ignore', log, log] });
    try {
      await bekle(port);
      const r = spawnSync(process.execPath, [path.join(__dirname, f)], { cwd: __dirname, env, stdio: 'inherit', timeout: 10 * 60000 });
      if (r.status !== 0) {
        basarisiz++;
        console.log(`✖ ${f} başarısız. Sunucu kaydının sonu:\n` + fs.readFileSync(path.join(dir, 'sunucu.log'), 'utf8').split('\n').slice(-30).join('\n'));
      }
    } catch (e) {
      basarisiz++;
      console.log(`✖ ${f}: ${e.message}`);
    } finally {
      srv.kill();
      await new Promise((r) => srv.once('exit', r));
      if (!basarisiz) fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  console.log(basarisiz ? `\n✖ ${basarisiz} test dosyası başarısız.` : `\n✔ ${dosyalar.length} test dosyasının hepsi geçti.`);
  process.exit(basarisiz ? 1 : 0);
})();
