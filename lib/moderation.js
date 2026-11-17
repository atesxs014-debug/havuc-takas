// Yasaklı kelime filtresi: eşleşen ilanlar "onay bekliyor" durumuna düşer.
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');

const FILE = path.join(__dirname, '..', 'data', 'yasakli-kelimeler.txt');

const norm = (s) => String(s).toLocaleLowerCase('tr').replace(/\s+/g, ' ');

function defaultList() {
  try { return fs.readFileSync(FILE, 'utf8'); } catch { return ''; }
}

function wordsText() {
  return db.setting('banned_words', null) ?? defaultList();
}

function words() {
  return wordsText().split('\n').map((l) => norm(l.trim())).filter((l) => l && !l.startsWith('#'));
}

/** Metinde geçen yasaklı ifadeleri döndürür ([] ise temiz) */
function check(...texts) {
  const t = ' ' + norm(texts.join(' ')).replace(/[^\p{L}\p{N}+ ]/gu, ' ') + ' ';
  const hits = [];
  for (const w of words()) {
    const wn = w.replace(/[^\p{L}\p{N}+ ]/gu, ' ');
    // kelime başında eşleşme (ek almış hâlleri de yakalar: "kaporası", "silahlar")
    if (t.includes(' ' + wn)) hits.push(w);
  }
  if (/\bTR\s?\d{2}(\s?\d{4}){5}\s?\d{2}\b/i.test(texts.join(' '))) hits.push('IBAN numarası');
  return [...new Set(hits)];
}

module.exports = { check, wordsText, setWords: (txt) => db.setSetting('banned_words', txt) };
