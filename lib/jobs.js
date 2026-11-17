// Arka plan görevleri: günde bir kez yedek + reklam hatırlatmaları
const config = require('./config');
const backup = require('./backup');
const notify = require('./notify');
const { expireOld } = require('./ads');

let lastDay = null;
function tick() {
  require('./orders').otomatik().catch((e) => console.error('Sipariş kontrolü:', e.message));
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
  try { expireOld(); } catch (e) { console.error(e); }
  try { require('./ilan-sure').kontrol(); } catch (e) { console.error('İlan süresi kontrolü:', e.message); }
  try { require('./vitrin').temizle(); } catch (e) { console.error(e); }
  try { require('./teklif').temizle(); } catch (e) { console.error('Teklif temizliği:', e.message); }
  if (day === lastDay) return;
  lastDay = day;
  try { if (config.backup.enabled) backup.run(); } catch (e) { console.error('Yedek alınamadı:', e.message); }
  try { notify.adReminders(); } catch (e) { console.error('Hatırlatma hatası:', e.message); }
  try { require('./bildirim').gunlukOzet(); } catch (e) { console.error('Arama özeti hatası:', e.message); }
}

function start() {
  setTimeout(tick, 5000).unref();
  setInterval(tick, 30 * 60000).unref();
}

module.exports = { start, tick };
