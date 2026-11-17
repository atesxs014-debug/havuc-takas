# 🥕 Havuç Takas

Komisyonsuz ikinci el ve takas ilan platformu. Ekran kaydındaki siteye göre baştan yeniden yazıldı.
Yeni özellik: **her il ve her ilçe için 4 yerel işletme reklam alanı** (81 il + 973 ilçe = 1.054 bölge, 4.216 alan).

## Hızlı başlangıç

Gerekenler: **Node.js 22.13 veya üstü** (yerleşik SQLite kullanılır, ayrı veritabanı kurmaya gerek yok).

```bash
npm install
npm run seed     # isteğe bağlı: videodaki 6 örnek ilan + 1 örnek reklam
npm start        # http://localhost:3000
```

İlk kayıt olan kullanıcı **yönetici** olur (ya da `.env` içinde `ADMIN_EMAIL` verin). Yönetim paneli: `/yonetim`.

Yerelde `NODE_ENV=production` ile ama HTTPS olmadan çalıştıracaksanız `COOKIE_SECURE=0` verin, yoksa giriş yapılamaz.

## Özellikler

| Sayfa | Adres |
|---|---|
| Anasayfa (il/ilçe filtresi, son ilanlar, kategoriler) | `/` |
| İlanlar (arama, sıralama, il/ilçe, kategori, tür, sayfalama) | `/ilanlar` |
| İl / ilçe sayfası + o bölgenin 4 reklam alanı | `/il/izmir`, `/il/izmir/buca` |
| İlan detay (satıcı kartı, mesaj, şikayet, bölge reklamları, benzer ilanlar) | `/ilan/6-az-kullanilmis-dag-bisikleti` |
| İlan ver / düzenle / satıldı / kaldır (fotoğraf yükleme) | `/ilan-ver` |
| Üyelik, giriş, hesabım | `/kayit`, `/giris`, `/hesabim` |
| Mesajlaşma (ilan bazlı konuşmalar, okunmamış sayacı) | `/mesajlar` |
| İşletmeniz için reklam verin (canlı doluluk, alan seçimi, logo) | `/reklam-ver` |
| 81 ilin reklam doluluk tablosu | `/reklam-alanlari` |
| Yönetim: reklam onay/ret/uzatma/durdurma, şikayetler, ilanlar, üyeler | `/yonetim` |
| KVKK, Gizlilik, Kullanım Şartları, Güvenli Takas | `/kvkk` … |

### Reklam alanları nasıl çalışır?

- Her **ilçe** için 4 alan: o ilçenin ilan listesinde (`/il/izmir/buca`) ve o ilçedeki her ilan sayfasında gösterilir.
- Her **il** için 4 alan (il geneli): il sayfasında (`/il/izmir`) gösterilir.
- Boş alanlarda "Bu alan müsait — Reklam ver" kartı çıkar; tıklanınca form o il/ilçe/alan seçili açılır.
- İşletme başvurur → yönetici `/yonetim`'de onaylar (alan numarasını ve süreyi değiştirebilir) → reklam yayına girer.
  Aynı alana iki reklam onaylanamaz. Süresi biten reklamlar otomatik kapanır.
- Gösterim ve tıklama sayıları tutulur. Aylık fiyatları `.env` içindeki `AD_PRICE_ILCE` ve `AD_PRICE_IL` ile ayarlayın.
- Ödeme sistemi yoktur; ödeme haricen alınıp yönetici onayıyla yayına alınır.

## Yayına alma

Herhangi bir Node.js sunucusunda (VPS, Render, Railway, Fly.io…) çalışır:

```bash
cp .env.example .env   # SESSION_SECRET ve diğer ayarları doldurun
npm ci --omit=dev
npm start
```

veya Docker ile:

```bash
docker build -t havuc-takas .
docker run -d -p 3000:3000 -v havuc-data:/data -e SESSION_SECRET=... havuc-takas
```

`data/havuc.db` (veritabanı) ve `uploads/` (görseller) kalıcı bir diskte olmalı; yedeklerini alın.

## Klasör yapısı

```
server.js            Express uygulaması
lib/                 veritabanı, il-ilçe, kategoriler, reklam alanları, yardımcılar
routes/              public, auth, listings, messages, ads, admin
views/               EJS şablonları
public/              CSS, JS, ikon
data/il-ilce.json    81 il, 973 ilçe (turkey-neighbourhoods / PTT verisi, MIT)
scripts/seed.js      örnek veri
```
