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
  if (day === lastDay) return;
  lastDay = day;
  try { if (config.backup.enabled) backup.run(); } catch (e) { console.error('Yedek alınamadı:', e.message); }
  try { notify.adReminders(); } catch (e) { console.error('Hatırlatma hatası:', e.message); }
}

function start() {
  setTimeout(tick, 5000).unref();
  setInterval(tick, 30 * 60000).unref();
}

module.exports = { start, tick };
