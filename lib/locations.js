// 81 il ve 973 ilçe (kaynak: turkey-neighbourhoods, PTT verisi - MIT)
const iller = require('../data/il-ilce.json');

const ilBySlug = new Map();
for (const il of iller) {
  il.ilceBySlug = new Map(il.ilceler.map((i) => [i.slug, i]));
  ilBySlug.set(il.slug, il);
}

function getIl(slug) {
  return slug ? ilBySlug.get(slug) || null : null;
}

function getIlce(ilSlug, ilceSlug) {
  const il = getIl(ilSlug);
  return il && ilceSlug ? il.ilceBySlug.get(ilceSlug) || null : null;
}

// "Buca, İzmir" gibi okunur konum
function konumAdi(ilSlug, ilceSlug) {
  const il = getIl(ilSlug);
  if (!il) return '';
  const ilce = getIlce(ilSlug, ilceSlug);
  return ilce ? `${ilce.ad}, ${il.ad}` : il.ad;
}

// İstemci tarafı için sade liste (select kutuları)
const publicList = iller.map((il) => ({
  s: il.slug,
  a: il.ad,
  p: il.plaka,
  i: il.ilceler.map((x) => [x.slug, x.ad]),
}));

const toplamIlce = iller.reduce((t, il) => t + il.ilceler.length, 0);

module.exports = { iller, getIl, getIlce, konumAdi, publicList, toplamIlce };
