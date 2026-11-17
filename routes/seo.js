// robots.txt, sitemap.xml ve çevrimdışı sayfası
const express = require('express');
const db = require('../lib/db');
const h = require('../lib/helpers');
const { iller } = require('../lib/locations');

const router = express.Router();

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(['User-agent: *', 'Disallow: /yonetim', 'Disallow: /mesajlar', 'Disallow: /hesabim',
    'Disallow: /isletme', 'Disallow: /favorilerim', 'Disallow: /api/', 'Disallow: /reklam/',
    `Sitemap: ${h.baseUrl(req)}/sitemap.xml`, ''].join('\n'));
});

const listingsQ = db.prepare(`SELECT id, title, created_at FROM listings WHERE status = 'active' ORDER BY id DESC LIMIT 40000`);
const locWithListings = db.prepare(`SELECT il, ilce, MAX(created_at) AS son FROM listings WHERE status = 'active' GROUP BY il, ilce`);

const xmlEsc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

let cache = { t: 0, body: '' };
router.get('/sitemap.xml', (req, res) => {
  if (Date.now() - cache.t > 10 * 60000) {
    const b = h.baseUrl(req);
    const urls = [];
    const add = (loc, lastmod, pr) => urls.push(`<url><loc>${xmlEsc(b + loc)}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ''}${pr ? `<priority>${pr}</priority>` : ''}</url>`);
    add('/', null, '1.0');
    add('/ilanlar', null, '0.9');
    add('/reklam-ver', null, '0.6');
    add('/reklam-alanlari', null, '0.4');
    for (const p of ['guvenli-takas', 'sss', 'hakkimizda', 'iletisim', 'kvkk', 'gizlilik', 'kullanim-sartlari']) add('/' + p, null, '0.2');
    const son = new Map(locWithListings.all().map((r) => [`${r.il}/${r.ilce}`, r.son]));
    // Tüm il sayfaları; ilçe sayfalarından ilanı olanlar (boş sayfaları dizine sokmayalım)
    for (const il of iller) {
      add(`/il/${il.slug}`, null, '0.7');
      for (const i of il.ilceler) if (son.has(`${il.slug}/${i.slug}`)) add(`/il/${il.slug}/${i.slug}`, son.get(`${il.slug}/${i.slug}`), '0.6');
    }
    for (const l of listingsQ.all()) add(h.ilanUrl(l), l.created_at, '0.8');
    cache = { t: Date.now(), body: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>` };
  }
  res.type('application/xml').send(cache.body);
});

router.get('/cevrimdisi', (req, res) => res.render('offline', { title: 'Çevrimdışı', noindex: true }));

module.exports = router;
