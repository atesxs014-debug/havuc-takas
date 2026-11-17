// Hassas verileri (IBAN, TC kimlik no) veritabanında şifreli saklamak için AES-256-GCM
const crypto = require('node:crypto');
const config = require('./config');

const key = crypto.createHash('sha256').update('havuc-veri:' + (process.env.DATA_KEY || config.SESSION_SECRET)).digest();

function seal(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

function open(box) {
  try {
    const [iv, tag, enc] = box.split('.').map((s) => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return null; }
}

// TC kimlik numarası algoritma kontrolü
function tcknOk(t) {
  if (!/^[1-9]\d{10}$/.test(t)) return false;
  const d = t.split('').map(Number);
  const d10 = ((d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - (d[1] + d[3] + d[5] + d[7])) % 10;
  const d11 = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return ((d10 + 10) % 10) === d[9] && d11 === d[10];
}

// TR IBAN kontrolü (mod 97)
function ibanOk(raw) {
  const iban = String(raw).replace(/\s+/g, '').toUpperCase();
  if (!/^TR\d{24}$/.test(iban)) return false;
  const re = iban.slice(4) + iban.slice(0, 4);
  const num = re.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of num) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

module.exports = { seal, open, tcknOk, ibanOk, normIban: (s) => String(s).replace(/\s+/g, '').toUpperCase() };
