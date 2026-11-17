// E-posta gönderimi. SMTP ayarlı değilse e-postalar konsola ve data/epostalar klasörüne yazılır.
const fs = require('node:fs');
const path = require('node:path');
const nodemailer = require('nodemailer');
const config = require('./config');

const transport = config.smtp ? nodemailer.createTransport(config.smtp) : null;
const OUTBOX = path.join(config.DATA_DIR, 'epostalar');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(title, paragraphs, button) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.5">${esc(p)}</p>`).join('');
  const btn = button ? `<p style="margin:20px 0"><a href="${esc(button.url)}" style="background:#17873f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">${esc(button.text)}</a></p>
    <p style="font-size:12px;color:#6b7280">Buton çalışmazsa bu adresi tarayıcınıza yapıştırın:<br>${esc(button.url)}</p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:Arial,sans-serif;color:#1c1f23">
  <div style="max-width:520px;margin:0 auto;padding:24px">
    <p style="font-size:20px;font-weight:bold;color:#17873f;margin:0 0 16px">🥕 Havuç Takas</p>
    <div style="background:#fff;border-radius:12px;padding:24px">
      <h1 style="font-size:18px;margin:0 0 14px">${esc(title)}</h1>${body}${btn}
    </div>
    <p style="font-size:11px;color:#6b7280;text-align:center;margin-top:16px">Bu e-postayı Havuç Takas hesabınızla ilgili bir işlem nedeniyle aldınız.</p>
  </div></body></html>`;
}

/** send({ to, subject, title, lines: [], button: {text,url} }) — hata fırlatmaz */
async function send({ to, subject, title, lines = [], button = null }) {
  const html = layout(title || subject, lines, button);
  const text = [title || subject, '', ...lines, button ? `\n${button.text}: ${button.url}` : ''].join('\n');
  try {
    if (transport) {
      await transport.sendMail({ from: config.MAIL_FROM, to, subject, text, html });
    } else {
      fs.mkdirSync(OUTBOX, { recursive: true });
      const f = path.join(OUTBOX, `${new Date().toISOString().replace(/[:.]/g, '-')}-${String(to).replace(/[^a-z0-9@.]/gi, '_')}.txt`);
      fs.writeFileSync(f, `Kime: ${to}\nKonu: ${subject}\n\n${text}\n`);
      console.log(`✉️  [SMTP yok] ${to} — ${subject}${button ? `\n   ${button.url}` : ''}`);
    }
    return true;
  } catch (e) {
    console.error('E-posta gönderilemedi:', to, subject, e.message);
    return false;
  }
}

module.exports = { send, OUTBOX };
