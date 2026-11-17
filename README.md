# 🥕 Havuç Takas

Komisyonsuz ikinci el ve takas ilan platformu. Ekran kaydındaki siteye göre baştan yeniden yazıldı.
Yeni özellik: **her il ve her ilçe için 4 yerel işletme reklam alanı** (81 il + 973 ilçe = 1.054 bölge, 4.216 alan).

## Kendi bilgisayarında çalıştırma (en kolay yol)

1. [Node.js](https://nodejs.org/tr/download) **LTS** sürümünü kur (22 veya üstü).
2. Klasördeki **`baslat.bat`** (Windows) veya **`baslat.command`** (Mac) dosyasına çift tıkla.
   İlk açılışta gerekli paketler kurulur ve örnek ilanlar eklenir, ardından tarayıcıda `http://localhost:3000` açılır.
3. Siteye ilk **üye olan kişi yönetici** olur. Yönetim paneli: `/yonetim`.

Terminalden: `npm install` → `npm run seed` (isteğe bağlı) → `npm start`

SMTP ayarlamadan çalıştırırsan e-postalar gönderilmez; terminal penceresine ve `data/epostalar/` klasörüne yazılır
(doğrulama ve şifre sıfırlama bağlantılarını oradan açabilirsin). Bu durumda e-posta doğrulaması zorunlu değildir.

Tüm ayarlar `.env` dosyasında (ilk çalıştırmada `.env.example`'dan kopyalanır, açıklamaları içinde):
havale bilgileri (`BANK_IBAN`…), SMTP, Turnstile, Umami/Plausible, yedek klasörü.

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
| E-posta doğrulama, şifremi unuttum, hesap ayarları | `/sifremi-unuttum`, `/hesabim/ayarlar` |
| Favoriler, satıcı profili ve puanları | `/favorilerim`, `/uye/1` |
| İşletme paneli (gösterim/tıklama grafiği, düzenleme, süre uzatma) | `/isletme` |

### Sürüm 2 ile gelenler

- **Havale/EFT ile reklam ödemesi:** başvurudan sonra tutar, IBAN ve kişiye özel referans kodu (`HVC00012`) gösterilir ve e-postalanır. Yönetici "Ödeme alındı → Yayınla" ile yayına alır. Süre uzatmada da aynı akış.
- **Kademeli fiyat:** İstanbul/Ankara/İzmir, diğer 27 büyükşehir ve diğer 51 il için ayrı ilçe ve il geneli aylık fiyatları; istenen il/ilçeye özel fiyat. Hepsi `/yonetim → Fiyatlar`'dan girilir.
- **E-posta:** üyelik doğrulama, şifre sıfırlama, yeni mesaj bildirimi, reklam başvurusu/onayı/reddi, bitişe 7 gün kala hatırlatma, inceleme bildirimleri.
- **5 fotoğraf:** otomatik döndürme, küçültme (WEBP, en fazla 1600 px), kapak seçimi, kaydırılabilir galeri. iPhone HEIC fotoğrafları da kabul edilir.
- **Bot koruması:** tüm formlarda deneme sınırı; Turnstile anahtarı girilirse kayıt, giriş, şifre sıfırlama, ilan verme ve reklam formunda Cloudflare doğrulaması.
- **Yasaklı kelime filtresi:** eşleşen ilanlar "incelemede" kalır, yönetici onaylar/reddeder. Liste panelden düzenlenir; IBAN numaraları her zaman yakalanır.
- **Favoriler, satıcı profili, puanlama:** ilan "takas edildi/satıldı" işaretlendikten sonra, satıcıyla mesajlaşmış alıcı 1-5 yıldız verebilir.
- **PWA:** telefonda "Ana ekrana ekle" ile uygulama gibi açılır; çevrimdışı sayfası.
- **SEO:** `sitemap.xml`, `robots.txt`, canonical, WhatsApp/Instagram önizlemesi (Open Graph), Google yapısal verisi (WebSite + Product/Offer).
- **İstatistik:** `.env`'de Umami veya Plausible bilgisi girilirse çerezsiz ziyaretçi sayacı eklenir.
- **Günlük otomatik yedek:** veritabanı + yeni fotoğraflar `data/yedekler` (veya `BACKUP_DIR`) klasörüne; son 14 gün tutulur. Elle: `npm run yedek` veya panelden.

### Güvenli ödemeli kargo

- Satıcı bir kez **Ödeme Bilgilerim** sayfasından IBAN ve TC kimlik bilgisini girer (şifreli saklanır, iyzico'ya alt üye işyeri olarak kaydedilir). Sonra ilanında "Kargoyla satış" ve paket boyunu seçer.
- Alıcı "Kargoyla Satın Al" ile adresini girip kartla öder: **ürün + kargo + hizmet bedeli**. Para iyzico'da bekler.
- Satıcı 3 gün içinde kargoya verip takip numarasını girer (vermezse otomatik iade). Alıcı "Teslim aldım" deyince ya da 7 gün içinde sorun bildirmezse ödeme satıcıya aktarılır. "Sorun var" denirse yönetici `/yonetim → Siparişler`'den aktarır veya iade eder.
- Kargo ücretleri (küçük/orta/büyük paket) ve hizmet bedeli (yüzde + en az tutar) `/yonetim → Kargo ayarları`'ndan değiştirilir.
- `.env`'de `IYZICO_API_KEY` / `IYZICO_SECRET_KEY` yoksa **test ödeme modu** çalışır (gerçek para yok). Canlıda (`NODE_ENV=production`) iyzico anahtarı yoksa kargolu satış kapanır. Önce `IYZICO_URI=https://sandbox-api.iyzipay.com` ile deneyin.
- Canlıya almadan önce: şirket + iyzico Pazaryeri başvurusu, ETBİS kaydı, mesafeli satış/aracı hizmet sözleşmelerinin avukatça hazırlanması.

### Sürüm 3 ile gelenler

- **Arama:** her sayfanın üstünde ve anasayfada arama kutusu. Türkçe harf duyarsız ("çocuk" = "ÇOCUK" = "cocuk").
- **Filtreler:** fiyat aralığı ve ürün durumu (sıfır, az kullanılmış, iyi, kullanılmış, tamir gerektirir). Telefonda "Filtreler" butonuyla açılıp kapanır.
- **Kayıtlı arama + bildirim zili:** "Bu aramayı kaydet" → uygun yeni ilan çıkınca 🔔 zile bildirim, günde bir e-posta özeti. Mesaj, sipariş ve ilan onayı bildirimleri de zile düşer.
- **İlan süresi:** ilanlar 30 gün yayında kalır; bitmeden 3 gün önce "tek tıkla yenile" e-postası gider, süresi dolan ilan "Süresi doldu" olur ve sahibi yeniler.
- **Mesajlaşma:** fotoğraf gönderme ve kullanıcı engelleme (engellenen kişiyle iki taraf da mesajlaşamaz). Hesap Ayarları → Engellediklerim.
- **Üye engelleme (yönetici):** `/yonetim → Üyeler`'de ara ve "Kalıcı engelle". Üye giriş yapamaz, ilanları ve reklamları yayından kalkar, aynı e-postayla yeniden kayıt olamaz. Şikayetler sekmesinden de ilan sahibi tek tıkla engellenir.
- **Hesap silme + verilerimi indir (KVKK):** Hesap Ayarları'ndan. Sipariş kaydı olan hesaplar silinmez, anonimleştirilir.
- **Google ile giriş:** `.env`'e `GOOGLE_CLIENT_ID` ve `GOOGLE_CLIENT_SECRET` girilince giriş/kayıt sayfalarında "Google ile devam et" çıkar (aşağıda adımlar).
- **İletişim, Hakkımızda, SSS:** iletişim formu mesajları `/yonetim → İletişim`'e ve e-postana (`CONTACT_EMAIL`, boşsa yöneticilere) düşer.

### Sürüm 4 ile gelenler

- **Güvenlik:** CSP, HSTS (yalnızca canlıda HTTPS'te) ve diğer güvenlik başlıkları. 5 yanlış şifrede hesap 15 dakika kilitlenir ve sahibine e-posta gider. Yeni bir cihazdan giriş yapılınca e-posta + zil uyarısı.
- **E-posta değiştirme:** Hesap Ayarları'ndan. Yeni adrese onay bağlantısı gider, eski adrese bilgi verilir; bağlantıya tıklanınca değişir.
- **Teklifler:** alıcı fiyat teklif eder ya da kendi ilanıyla takas önerir. Satıcı kabul eder, reddeder veya karşı teklif verir (`/tekliflerim`). Kabul edilen fiyat, ilan kargoluysa o fiyattan güvenli satın almayı açar. Cevaplanmayan teklif 7 günde düşer.
- **Bedava ilan:** "🎁 Bedava (hediye)" ilan türü ve ilanlarda "Bedava" filtresi.
- **Paylaş:** ilan sayfasında WhatsApp, bağlantıyı kopyala ve telefonun paylaş menüsü.
- **Güvenilir satıcı rozeti:** e-postası doğrulanmış, en az 3 değerlendirmede ortalama 4,5+ alan ve son 90 günde iadesi olmayan satıcılara.
- **Canlı mesaj:** sohbette yeni mesajlar sayfa yenilenmeden gelir, gönderim de yenilemeden olur. Zil ve mesaj sayacı kendiliğinden güncellenir.
- **Telefona bildirim:** Bildirimler sayfasında "Bildirimleri aç" → site kapalıyken de telefona/bilgisayara bildirim düşer (iPhone'da önce siteyi ana ekrana eklemek gerekir). Anahtarlar `.env`'de yoksa otomatik üretilir.
- **Fiyat düştü:** favorideki ilanın fiyatı düşünce zil + e-posta.
- **Yönetim grafikleri:** `/yonetim → İstatistikler`: son 30 günün yeni üye, ilan, mesaj, teklif, kargo cirosu ve site geliri grafikleri.

### Google ile giriş nasıl açılır?

1. https://console.cloud.google.com adresinde bir proje oluştur.
2. **APIs & Services → OAuth consent screen**: uygulama adı "Havuç Takas", destek e-postan; kapsamlar `email`, `profile`, `openid`.
3. **Credentials → Create credentials → OAuth client ID → Web application**.
   *Authorized redirect URIs* kısmına ekle: `http://localhost:3000/giris/google/donus` (yayına alınca `https://alanadin.com/giris/google/donus`).
4. Verilen *Client ID* ve *Client secret*'ı `.env` dosyasına `GOOGLE_CLIENT_ID=` ve `GOOGLE_CLIENT_SECRET=` olarak yaz, siteyi yeniden başlat.

### Testler

`npm test` tüm uçtan uca testleri çalıştırır (her test kendi boş veritabanıyla). İlk seferde tarayıcı için `npx playwright install chromium` gerekir.
GitHub'da her gönderimde ve PR'da testler otomatik çalışır (`.github/workflows/test.yml`).

### Reklam alanları nasıl çalışır?

- Her **ilçe** için 4 alan: o ilçenin ilan listesinde (`/il/izmir/buca`) ve o ilçedeki her ilan sayfasında gösterilir.
- Her **il** için 4 alan (il geneli): il sayfasında (`/il/izmir`) gösterilir.
- Boş alanlarda "Bu alan müsait — Reklam ver" kartı çıkar; tıklanınca form o il/ilçe/alan seçili açılır.
- İşletme başvurur → yönetici `/yonetim`'de onaylar (alan numarasını ve süreyi değiştirebilir) → reklam yayına girer.
  Aynı alana iki reklam onaylanamaz. Süresi biten reklamlar otomatik kapanır.
- Gösterim ve tıklama sayıları günlük olarak tutulur, işletme kendi panelinde görür.

## Yayına alma

Herhangi bir Node.js sunucusunda (VPS, Render, Railway, Fly.io…) çalışır:

```bash
cp .env.example .env   # SITE_URL, SMTP, BANK_IBAN vb. doldurun
npm ci --omit=dev
npm start
```

veya Docker ile:

```bash
docker build -t havuc-takas .
docker run -d -p 3000:3000 -v havuc-data:/data -e SESSION_SECRET=... havuc-takas
```

`data/havuc.db` (veritabanı) ve `uploads/` (görseller) kalıcı bir diskte olmalı. Yedek klasörünü (`BACKUP_DIR`) farklı bir diske almanız önerilir.

## Klasör yapısı

```
server.js            Express uygulaması
lib/                 veritabanı, il-ilçe, kategoriler, reklam alanları, fiyatlar, e-posta,
                     fotoğraf, güvenlik, yasaklı kelime, yedek, zamanlanmış görevler
routes/              public, auth, listings, social, messages, ads, business, seo, admin
data/yasakli-kelimeler.txt  varsayılan yasaklı kelime listesi
views/               EJS şablonları
public/              CSS, JS, ikon
data/il-ilce.json    81 il, 973 ilçe (turkey-neighbourhoods / PTT verisi, MIT)
scripts/seed.js      örnek veri
```
