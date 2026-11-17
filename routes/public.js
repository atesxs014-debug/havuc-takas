const express = require('express');
const db = require('../lib/db');
const { publicList, toplamIlce, iller } = require('../lib/locations');

const router = express.Router();

const latest = db.prepare(`SELECT * FROM listings WHERE status = 'active' ORDER BY created_at DESC, id DESC LIMIT 12`);
const stats = db.prepare(`SELECT
  (SELECT COUNT(*) FROM listings WHERE status = 'active') AS ilan,
  (SELECT COUNT(*) FROM users) AS uye`);

router.get('/', (req, res) => {
  res.render('home', {
    ilanlar: latest.all(),
    stats: stats.get(),
    toplamAlan: (iller.length + toplamIlce) * 4,
    description: 'Komşundan al, komşuna ver. İl ve ilçene göre ikinci el eşya ve takas ilanları. 0₺ komisyon, elden teslim.',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Havuç Takas',
      url: res.locals.base + '/',
      potentialAction: { '@type': 'SearchAction', target: res.locals.base + '/ilanlar?q={search_term_string}', 'query-input': 'required name=search_term_string' },
    },
  });
});

// İl/ilçe listesi istemci için (bağımlı select kutuları)
const ilJs = 'window.TR_ILLER=' + JSON.stringify(publicList) + ';';
router.get('/iller.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'public, max-age=86400').send(ilJs);
});

// KVKK metni sitenin o an açık olan özelliklerine göre yazılır (kapalı özelliğin verisi anlatılmaz)
function kvkkBilgi() {
  const config = require('../lib/config');
  return {
    vs: config.kvkk,
    ozellik: {
      kargo: require('../lib/payments').kargoAcik(),
      google: !!config.google,
      turnstile: !!config.turnstile,
      analitik: !!((config.analytics.umamiSrc && config.analytics.umamiId) || config.analytics.plausibleDomain),
      smtp: !!config.smtp,
      yedekGun: config.backup.keepDays,
    },
  };
}

const sayfalar = {
  kvkk: { view: 'pages/kvkk', title: 'KVKK Aydınlatma Metni' },
  gizlilik: { view: 'pages/gizlilik', title: 'Gizlilik Politikası' },
  'kullanim-sartlari': { view: 'pages/kullanim-sartlari', title: 'Kullanım Şartları' },
  'guvenli-takas': { view: 'pages/guvenli-takas', title: 'Güvenli Takas Rehberi' },
};
for (const [slug, s] of Object.entries(sayfalar)) {
  router.get('/' + slug, (req, res) => res.render(s.view, { title: s.title, ...(slug === 'kvkk' ? kvkkBilgi() : {}) }));
}


module.exports = router;
