// Videodaki örnek ilanlarla demo veri oluşturur: npm run seed
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');

if (db.prepare('SELECT COUNT(*) AS n FROM listings').get().n > 0) {
  console.log('Veritabanında zaten ilan var, demo veri eklenmedi.');
  process.exit(0);
}

const sifre = crypto.randomBytes(6).toString('hex');
const email = 'demo@havuctakas.local';
let user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (!user) {
  const info = db.prepare('INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, ?, 0)')
    .run('Ates Yilmaz', email, bcrypt.hashSync(sifre, 10));
  user = { id: Number(info.lastInsertRowid) };
  console.log(`Demo kullanıcı: ${email} / ${sifre}`);
}

const ilanlar = [
  ['Node.js & JavaScript Kitap Seti (5 Kitap)', 'Beş kitaplık set, temiz durumda. Yazılıma yeni başlayanlar için ideal. Takas tekliflerine açığım.', 'kitap-hobi', null, 1, 'izmir', 'karsiyaka', 39],
  ['Otomatik Kahve Makinesi', 'Az kullanıldı, kutusu ve faturası mevcut. Kireç temizliği yeni yapıldı.', 'ev-aletleri', 1850, 0, 'izmir', 'bornova', 54],
  ['Çocuk Bisikleti 16 Jant - Takaslık', 'Yardımcı tekerleri mevcut. Çocuğum büyüdüğü için 20 jant bisikletle takas olur.', 'cocuk-bebek', null, 1, 'izmir', 'konak', 71],
  ['3+1 Kumaş Koltuk Takımı', 'Sigarasız evde kullanıldı, lekesiz. Kendiniz taşıyacak şekilde.', 'ev-yasam', 6250, 0, 'izmir', 'bayrakli', 96],
  ['iPhone 12 128GB - Takaslık', 'Pil sağlığı %86, ekranı çiziksiz. Android telefon ile takas düşünürüm.', 'elektronik', null, 1, 'izmir', 'karabaglar', 342],
  ['Az Kullanılmış Dağ Bisikleti', 'Neredeyse yeni, 6 ay kullanıldı. Vites sorunsuz çalışıyor.', 'spor-outdoor', 3500, 0, 'izmir', 'buca', 131],
];
const ins = db.prepare(`INSERT INTO listings (user_id, title, description, category, price, is_swap, il, ilce, views, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`);
ilanlar.forEach((l, i) => ins.run(user.id, ...l, `-${(ilanlar.length - i) * 7} minutes`));

db.prepare(`INSERT INTO ads (il, ilce, slot, business_name, description, phone, address, contact_name, contact_email, months,
  status, start_date, end_date) VALUES ('izmir', 'buca', 1, 'Örnek Fırın (demo)', 'Bu bir örnek reklamdır. Yönetim panelinden kaldırabilirsiniz.',
  '0232 000 00 00', 'Buca, İzmir', 'Demo', 'demo@havuctakas.local', 1, 'active', date('now','localtime'), date('now','localtime','+1 months'))`).run();

console.log(`${ilanlar.length} demo ilan ve 1 örnek reklam (İzmir/Buca, 1. alan) eklendi.`);
