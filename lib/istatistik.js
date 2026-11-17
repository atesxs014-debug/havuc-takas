// Yönetim paneli grafikleri: son 30 günün günlük sayıları (sunucuda SVG çizilir, dışarıdan kütüphane yok)
const db = require('./db');

const GUN = 30;
const gunler = () => {
  const out = [];
  for (let i = GUN - 1; i >= 0; i--) out.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
  return out;
};

function seri(sql) {
  const rows = db.prepare(sql).all(`-${GUN} days`);
  const m = new Map(rows.map((r) => [r.g, Number(r.n) || 0]));
  return gunler().map((g) => ({ g, n: m.get(g) || 0 }));
}

function hepsi() {
  return [
    { ad: 'Yeni üyeler', birim: '', veri: seri("SELECT date(created_at) g, COUNT(*) n FROM users WHERE created_at >= datetime('now', ?) GROUP BY g") },
    { ad: 'Yeni ilanlar', birim: '', veri: seri("SELECT date(created_at) g, COUNT(*) n FROM listings WHERE created_at >= datetime('now', ?) GROUP BY g") },
    { ad: 'Mesajlar', birim: '', veri: seri("SELECT date(created_at) g, COUNT(*) n FROM messages WHERE created_at >= datetime('now', ?) GROUP BY g") },
    { ad: 'Teklifler', birim: '', veri: seri("SELECT date(created_at) g, COUNT(*) n FROM offers WHERE created_at >= datetime('now', ?) GROUP BY g") },
    { ad: 'Kargolu satış cirosu', birim: ' TL', veri: seri(`SELECT date(paid_at) g, SUM(total) n FROM orders
        WHERE paid_at IS NOT NULL AND status NOT IN ('iade', 'iptal') AND paid_at >= datetime('now', ?) GROUP BY g`) },
    { ad: 'Reklam geliri (onaylanan ödemeler)', birim: ' TL', veri: seri(`SELECT date(start_date) g, SUM(price) n FROM ads
        WHERE paid = 1 AND price IS NOT NULL AND start_date >= date('now', ?) GROUP BY g`) },
  ].map((s) => ({ ...s, toplam: s.veri.reduce((t, x) => t + x.n, 0), max: Math.max(0, ...s.veri.map((x) => x.n)) }));
}

// Tek serilik çubuk grafik: 2px boşluk, üstte 4px yuvarlak uç, her çubukta üzerine gelince değer
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tarihKisa = (g) => new Date(g + 'T12:00:00Z').toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
const sayi = (n) => new Intl.NumberFormat('tr-TR').format(n);

function svg(s) {
  const W = 300, H = 100, alt = 16;
  const max = Math.max(1, ...s.veri.map((x) => x.n));
  const bw = W / s.veri.length;
  const r = 2;
  const bars = s.veri.map((x, i) => {
    const h = x.n ? Math.max(3, (x.n / max) * (H - alt - 4)) : 0;
    const x0 = i * bw + 1, w = bw - 2, y = H - alt - h;
    const ipucu = `<title>${esc(tarihKisa(x.g))}: ${sayi(x.n)}${esc(s.birim)}</title>`;
    // Görünmez geniş alan: üzerine gelmek kolay olsun
    const hedef = `<rect x="${(i * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H - alt}" fill="transparent">${ipucu}</rect>`;
    if (!h) return hedef;
    const yol = `M${x0.toFixed(1)},${H - alt} V${(y + r).toFixed(1)} Q${x0.toFixed(1)},${y.toFixed(1)} ${(x0 + r).toFixed(1)},${y.toFixed(1)} H${(x0 + w - r).toFixed(1)} Q${(x0 + w).toFixed(1)},${y.toFixed(1)} ${(x0 + w).toFixed(1)},${(y + r).toFixed(1)} V${H - alt} Z`;
    return `<g><path class="cubuk" d="${yol}"/>${hedef}</g>`;
  }).join('');
  const ilk = s.veri[0].g, son = s.veri[s.veri.length - 1].g;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.ad)}, son ${GUN} gün, en yüksek ${sayi(max)}${esc(s.birim)}">
<line class="eksen" x1="0" x2="${W}" y1="${H - alt}" y2="${H - alt}"/>${bars}
<text class="eksen-yazi" x="0" y="${H - 3}">${esc(tarihKisa(ilk))}</text><text class="eksen-yazi" x="${W}" y="${H - 3}" text-anchor="end">${esc(tarihKisa(son))}</text></svg>`;
}

module.exports = { GUN, hepsi, svg, sayi };
