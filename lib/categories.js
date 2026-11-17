// Kategoriler: videodaki renkli kart + beyaz çizgi ikon tasarımı
const svg = (inner) =>
  `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const kategoriler = [
  { slug: 'spor-outdoor', ad: 'Spor & Outdoor', renk: ['#2f9e78', '#14684f'],
    ikon: svg('<circle cx="15" cy="40" r="10"/><circle cx="49" cy="40" r="10"/><path d="M15 40l10-14h18l6 14M25 26l8 14h-18M43 26l-3-8h-6M33 40l10-14"/>') },
  { slug: 'elektronik', ad: 'Elektronik', renk: ['#7b5bd6', '#4b33a8'],
    ikon: svg('<rect x="20" y="8" width="24" height="48" rx="5" fill="#4b33a8"/><path d="M29 50h6"/>') },
  { slug: 'ev-yasam', ad: 'Ev & Mobilya', renk: ['#f59a3a', '#d9711a'],
    ikon: svg('<path d="M10 26v20h44V26" fill="#fff"/><rect x="18" y="28" width="12" height="7" rx="2" fill="#fcd9b0" stroke="none"/><rect x="34" y="28" width="12" height="7" rx="2" fill="#fcd9b0" stroke="none"/>') },
  { slug: 'cocuk-bebek', ad: 'Çocuk & Bebek', renk: ['#f06a8f', '#d9466f'],
    ikon: svg('<circle cx="18" cy="42" r="8"/><circle cx="46" cy="42" r="8"/><path d="M18 42l14-10 14 10M32 32v-8M28 22h8"/>') },
  { slug: 'ev-aletleri', ad: 'Ev Aletleri', renk: ['#8a5a3c', '#5e3a24'],
    ikon: svg('<rect x="20" y="10" width="24" height="34" rx="3" fill="#fff"/><rect x="25" y="15" width="14" height="8" rx="1" fill="#5e3a24" stroke="none"/><path d="M28 44v10h8V44"/>') },
  { slug: 'kitap-hobi', ad: 'Kitap & Hobi', renk: ['#2f7fd6', '#1a5aa8'],
    ikon: svg('<rect x="14" y="14" width="10" height="38" fill="#fff" stroke="none"/><rect x="27" y="18" width="10" height="34" fill="#fcd98a" stroke="none"/><rect x="40" y="16" width="10" height="36" fill="#9cc8f5" stroke="none"/>') },
  { slug: 'giyim-aksesuar', ad: 'Giyim & Aksesuar', renk: ['#e0573f', '#b23a26'],
    ikon: svg('<path d="M24 10l-12 8 5 10 5-3v29h20V25l5 3 5-10-12-8c-1 4-4 6-8 6s-7-2-8-6z" fill="#fff"/>') },
  { slug: 'arac-parca', ad: 'Araç & Yedek Parça', renk: ['#4a5563', '#2b333d'],
    ikon: svg('<path d="M10 38l4-12c1-3 3-4 6-4h24c3 0 5 1 6 4l4 12v8H10z"/><circle cx="20" cy="46" r="5" fill="#2b333d"/><circle cx="44" cy="46" r="5" fill="#2b333d"/>') },
  { slug: 'diger', ad: 'Diğer', renk: ['#3aa76d', '#217a4c'],
    ikon: svg('<path d="M32 22c-6-10-18-6-14 4 3 7 14 10 14 10s11-3 14-10c4-10-8-14-14-4z"/><path d="M32 36v18"/>') },
];

const bySlug = new Map(kategoriler.map((k) => [k.slug, k]));
const getKategori = (slug) => bySlug.get(slug) || bySlug.get('diger');

module.exports = { kategoriler, getKategori, isKategori: (s) => bySlug.has(s) };
