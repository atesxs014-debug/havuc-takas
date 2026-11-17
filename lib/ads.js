// Yerel işletme reklam alanları: her il ve her ilçe için 4 slot.
const db = require('./db');

const SLOT_SAYISI = 4;

const q = {
  expire: db.prepare("UPDATE ads SET status = 'ended' WHERE status = 'active' AND end_date < date('now','localtime')"),
  active: db.prepare("SELECT * FROM ads WHERE il = ? AND ilce = ? AND status = 'active' ORDER BY slot"),
  occupiedBy: db.prepare("SELECT id FROM ads WHERE il = ? AND ilce = ? AND slot = ? AND status = 'active' AND id != ?"),
  pendingCount: db.prepare("SELECT slot, COUNT(*) AS n FROM ads WHERE il = ? AND ilce = ? AND status = 'pending' GROUP BY slot"),
  impress: db.prepare('UPDATE ads SET impressions = impressions + 1 WHERE id = ?'),
};

let lastExpire = 0;
function expireOld() {
  // Süresi dolan reklamları en fazla dakikada bir kapat
  if (Date.now() - lastExpire > 60000) {
    q.expire.run();
    lastExpire = Date.now();
  }
}

/** Bir konumun 4 reklam alanını döndürür: [{ slot, ad|null }] */
function getSlots(il, ilce = '', { countImpression = false } = {}) {
  expireOld();
  const rows = q.active.all(il, ilce || '');
  const slots = [];
  for (let s = 1; s <= SLOT_SAYISI; s++) {
    const ad = rows.find((r) => r.slot === s) || null;
    if (ad && countImpression) q.impress.run(ad.id);
    slots.push({ slot: s, ad });
  }
  return slots;
}

/** Reklam ver formu için doluluk bilgisi */
function availability(il, ilce = '') {
  const slots = getSlots(il, ilce);
  const pending = Object.fromEntries(q.pendingCount.all(il, ilce || '').map((r) => [r.slot, r.n]));
  return slots.map(({ slot, ad }) => ({
    slot,
    dolu: !!ad,
    bitis: ad ? ad.end_date : null,
    bekleyen: pending[slot] || 0,
  }));
}

function isSlotFree(il, ilce, slot, exceptId = 0) {
  expireOld();
  return !q.occupiedBy.get(il, ilce || '', slot, exceptId);
}

module.exports = { SLOT_SAYISI, getSlots, availability, isSlotFree, expireOld };
