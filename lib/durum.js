// Ürün durumu seçenekleri
const DURUMLAR = [
  ['sifir', 'Sıfır / Etiketli'],
  ['az', 'Az kullanılmış'],
  ['iyi', 'İyi durumda'],
  ['kullanilmis', 'Kullanılmış'],
  ['tamirlik', 'Tamir gerektirir'],
];
const DURUM_AD = Object.fromEntries(DURUMLAR);
module.exports = { DURUMLAR, DURUM_AD, isDurum: (d) => !!DURUM_AD[d] };
