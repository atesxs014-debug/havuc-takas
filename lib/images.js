// Fotoğraf yükleme: bellekte alınır, sharp ile küçültülüp WEBP olarak kaydedilir.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const sharp = require('sharp');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_FOTO = 5;
const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: MAX_FOTO },
  fileFilter: (req, file, cb) => {
    if (OK_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Sadece fotoğraf (JPG, PNG, WEBP, HEIC) yükleyebilirsiniz.'));
  },
});

function hataMesaji(err) {
  if (err.code === 'LIMIT_FILE_SIZE') return 'Her fotoğraf en fazla 10 MB olabilir.';
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return `En fazla ${MAX_FOTO} fotoğraf yükleyebilirsiniz.`;
  return err.message;
}

/** Formu ayrıştırır; hatayı req.uploadError'a yazar (sayfa çökmez) */
function parse(field, max) {
  const mw = max === 1 ? upload.single(field) : upload.array(field, max);
  return (req, res, next) => mw(req, res, (err) => {
    if (err) req.uploadError = hataMesaji(err);
    if (req.file) req.files = [req.file];
    req.files = (req.files || []).filter((f) => f.size > 0);
    next();
  });
}

const rnd = () => crypto.randomBytes(12).toString('hex');

/** İlan fotoğrafı: büyük (en fazla 1600px) + küçük kare-dışı kapak (640x480) */
async function saveListingPhoto(buf) {
  const base = rnd();
  const img = sharp(buf, { failOn: 'none' }).rotate(); // EXIF yönünü düzelt, meta veriyi sil
  await img.clone().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 }).toFile(path.join(UPLOAD_DIR, `${base}.webp`));
  await img.clone().resize({ width: 640, height: 480, fit: 'cover', position: 'attention' })
    .webp({ quality: 75 }).toFile(path.join(UPLOAD_DIR, `${base}-k.webp`));
  return { file: `${base}.webp`, thumb: `${base}-k.webp` };
}

/** İşletme logosu: 256x256 */
async function saveLogo(buf) {
  const name = `${rnd()}-logo.webp`;
  await sharp(buf, { failOn: 'none' }).rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 82 })
    .toFile(path.join(UPLOAD_DIR, name));
  return name;
}

function remove(...names) {
  for (const n of names) if (n) fs.unlink(path.join(UPLOAD_DIR, path.basename(n)), () => {});
}

module.exports = { UPLOAD_DIR, MAX_FOTO, parse, saveListingPhoto, saveLogo, remove };
