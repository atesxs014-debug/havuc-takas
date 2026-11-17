// Bildirimler, hesap silme / veri indirme, engellenenler, iletişim, hakkımızda, SSS
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const h = require('../lib/helpers');
const config = require('../lib/config');
const bildirim = require('../lib/bildirim');
const engel = require('../lib/engel');
const hesapSil = require('../lib/hesap-sil');
const { send } = require('../lib/mail');
const { rateLimit, turnstile } = require('../lib/security');

const router = express.Router();

// ---- Bildirimler ----
router.get('/bildirimler', h.requireLogin, (req, res) => {
  const liste = bildirim.liste(req.user.id);
  bildirim.hepsiOkundu(req.user.id);
  res.locals.bildirimSayisi = 0;
  res.render('notifications', { title: 'Bildirimler', liste, noindex: true });
});

// ---- Engellenenler ----
router.get('/hesabim/engellenenler', h.requireLogin, (req, res) => {
  res.render('blocks', { title: 'Engellediğim Kişiler', liste: engel.liste(req.user.id), noindex: true });
});

// ---- Verilerimi indir ----
router.get('/hesabim/verilerim', h.requireLogin, rateLimit('veri-indir', 10, 60), (req, res) => {
  const tarih = new Date().toISOString().slice(0, 10);
  res.set('Content-Disposition', `attachment; filename="havuc-takas-verilerim-${tarih}.json"`);
  res.type('application/json').send(JSON.stringify(hesapSil.disaAktar(req.user.id), null, 2));
});

// ---- Hesabımı sil ----
router.get('/hesabim/sil', h.requireLogin, (req, res) => {
  res.render('auth/delete', { title: 'Hesabımı Sil', engel: hesapSil.engel(req.user.id), noindex: true });
});

router.post('/hesabim/sil', h.requireLogin, rateLimit('hesap-sil', 5, 60), h.verifyCsrf, (req, res, next) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const view = (error) => res.status(400).render('auth/delete', { title: 'Hesabımı Sil', engel: hesapSil.engel(u.id), error, noindex: true });
  const e = hesapSil.engel(u.id);
  if (e) return view(e);
  if (u.password_hash === '!') {
    if (h.str(req.body.confirm_email, 200).toLowerCase() !== u.email) return view('Onay için e-posta adresini doğru yaz.');
  } else if (!bcrypt.compareSync(String(req.body.password || ''), u.password_hash)) {
    return view('Şifre hatalı.');
  }
  if (req.body.onay !== '1') return view('Silme işlemini onaylaman gerekiyor.');
  if (u.is_admin && db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n === 1) {
    return view('Sitenin tek yöneticisisin. Önce başka birini yönetici yapmalısın.');
  }
  try {
    hesapSil.sil(u.id);
  } catch (err) { return next(err); }
  send({ to: u.email, subject: 'Hesabın silindi', title: 'Havuç Takas hesabın silindi',
    lines: ['İsteğin üzerine hesabın ve kişisel verilerin silindi.', 'Yasal olarak saklamamız gereken sipariş/ödeme kayıtları anonim hale getirildi.', 'Bu işlemi sen yapmadıysan bize hemen ulaş.'] });
  req.session.regenerate(() => {
    h.flash(req, 'success', 'Hesabın ve kişisel verilerin silindi. Seni özleyeceğiz 🥕');
    res.redirect('/');
  });
});

// ---- İletişim ----
const KONULAR = ['Genel soru', 'Hesabım', 'İlan / şikayet', 'Kargo / sipariş', 'Reklam / işletme', 'KVKK başvurusu', 'Öneri'];
router.get('/iletisim', (req, res) => {
  res.render('pages/iletisim', { title: 'İletişim', KONULAR, form: { name: req.user ? req.user.name : '', email: req.user ? req.user.email : '', topic: req.query.konu || '' },
    description: 'Havuç Takas ile iletişime geç: sorular, öneriler, KVKK başvuruları.' });
});

router.post('/iletisim', rateLimit('iletisim', 5, 60), h.verifyCsrf, turnstile, (req, res) => {
  const form = {
    name: h.str(req.body.name, 80), email: h.str(req.body.email, 200).toLowerCase(),
    topic: KONULAR.includes(req.body.topic) ? req.body.topic : '', body: h.str(req.body.body, 4000),
  };
  let error = req.botError || null;
  if (!error && form.name.length < 2) error = 'Adını yaz.';
  else if (!error && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) error = 'Geçerli bir e-posta adresi yaz, sana buradan dönüş yapacağız.';
  else if (!error && !form.topic) error = 'Bir konu seç.';
  else if (!error && form.body.length < 10) error = 'Mesajın en az 10 karakter olmalı.';
  if (req.body.website) error = 'Gönderilemedi.'; // bal tuzağı
  if (error) return res.status(400).render('pages/iletisim', { title: 'İletişim', KONULAR, form, error });

  db.prepare('INSERT INTO contact_messages (user_id, name, email, topic, body) VALUES (?, ?, ?, ?, ?)')
    .run(req.user ? req.user.id : null, form.name, form.email, form.topic, form.body);
  const alicilar = config.CONTACT_EMAIL ? [config.CONTACT_EMAIL] : db.prepare('SELECT email FROM users WHERE is_admin = 1').all().map((r) => r.email);
  for (const to of alicilar) {
    send({ to, subject: `📮 İletişim: ${form.topic} — ${form.name}`, title: `Yeni iletişim mesajı (${form.topic})`,
      lines: [`${form.name} <${form.email}>`, form.body], button: { text: 'Yönetim panelinde aç', url: `${h.baseUrl(req)}/yonetim?tab=iletisim` } });
  }
  send({ to: form.email, subject: 'Mesajını aldık', title: 'Mesajın bize ulaştı',
    lines: [`Merhaba ${form.name.split(' ')[0]}, "${form.topic}" konulu mesajını aldık. En geç 2 iş günü içinde bu adrese dönüş yapacağız.`] });
  h.flash(req, 'success', 'Mesajın gönderildi. En geç 2 iş günü içinde e-postana dönüş yapacağız.');
  res.redirect('/iletisim');
});

router.get('/hakkimizda', (req, res) => res.render('pages/hakkimizda', { title: 'Hakkımızda', description: 'Havuç Takas: il ve ilçene göre komisyonsuz ikinci el ve takas platformu.' }));

const SSS = require('../lib/sss');
router.get('/sss', (req, res) => res.render('pages/sss', {
  title: 'Sıkça Sorulan Sorular', SSS, description: 'Havuç Takas hakkında sıkça sorulan sorular: ilan verme, kargo, güvenlik, reklam.',
  jsonLd: { '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: SSS.flatMap((b) => b.sorular).map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
}));

module.exports = router;
