(function () {
  // Mobil menü
  var btn = document.getElementById('menuBtn');
  var nav = document.getElementById('nav');
  if (btn && nav) {
    btn.addEventListener('click', function () {
      var acik = nav.classList.toggle('acik');
      btn.setAttribute('aria-expanded', acik ? 'true' : 'false');
    });
  }

  // Onay isteyen butonlar
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-confirm]');
    if (el && !window.confirm(el.getAttribute('data-confirm'))) e.preventDefault();
  });

  // İl -> ilçe bağımlı select kutuları
  function ilceDoldur(ilSel) {
    var ilceSel = ilSel.parentElement.querySelector('.js-ilce') || ilSel.form && ilSel.form.querySelector('.js-ilce');
    if (!ilceSel || !window.TR_ILLER) return;
    var il = window.TR_ILLER.find(function (x) { return x.s === ilSel.value; });
    var secili = ilceSel.value || ilceSel.getAttribute('data-selected');
    ilceSel.innerHTML = '';
    var bos = document.createElement('option');
    bos.value = '';
    bos.textContent = ilceSel.getAttribute('data-bos') || 'Tüm İlçeler';
    ilceSel.appendChild(bos);
    if (il) il.i.forEach(function (i) {
      var o = document.createElement('option');
      o.value = i[0]; o.textContent = i[1];
      if (i[0] === secili) o.selected = true;
      ilceSel.appendChild(o);
    });
    ilceSel.disabled = !il;
  }
  document.querySelectorAll('.js-il').forEach(function (s) {
    s.addEventListener('change', function () {
      var ilce = (s.parentElement.querySelector('.js-ilce') || s.form.querySelector('.js-ilce'));
      if (ilce) { ilce.value = ''; ilce.removeAttribute('data-selected'); }
      ilceDoldur(s);
      alanlariGetir();
    });
    if (window.TR_ILLER) ilceDoldur(s);
  });

  // İlan türü "Sadece takas" ise fiyat alanını gizle
  var fiyat = document.querySelector('.js-fiyat');
  if (fiyat) {
    var tur = function () {
      var t = document.querySelector('input[name=tur]:checked');
      var yok = t && (t.value === 'takas' || t.value === 'bedava');
      fiyat.style.display = yok ? 'none' : '';
      var kargoAlan = document.querySelector('.js-kargo');
      if (kargoAlan) kargoAlan.style.display = yok ? 'none' : '';
    };
    document.querySelectorAll('input[name=tur]').forEach(function (r) { r.addEventListener('change', tur); });
    tur();
  }

  // Reklam ver: seçilen il/ilçedeki 4 alanın doluluk durumu
  var alanKutu = document.getElementById('alanSecim');
  var aylikFiyat = null;
  var sureSel = document.querySelector('.js-sure');
  function tutarGuncelle() {
    var kutu = document.getElementById('tutarKutu');
    if (!kutu || !sureSel) return;
    if (aylikFiyat) {
      var ay = parseInt(sureSel.value, 10) || 1;
      document.getElementById('tutar').textContent = (aylikFiyat * ay).toLocaleString('tr-TR') + ' TL (' + aylikFiyat.toLocaleString('tr-TR') + ' TL × ' + ay + ' ay)';
      kutu.hidden = false;
    } else {
      kutu.hidden = true;
    }
  }
  if (sureSel) sureSel.addEventListener('change', tutarGuncelle);
  function alanlariGetir() {
    if (!alanKutu) return;
    var form = alanKutu.closest('form');
    var il = form.querySelector('.js-il').value;
    var ilce = form.querySelector('.js-ilce').value;
    if (!il) { alanKutu.innerHTML = '<p class="kucuk">Alan durumunu görmek için il seçin.</p>'; return; }
    var secili = alanKutu.getAttribute('data-secili');
    fetch('/api/reklam-alanlari?il=' + encodeURIComponent(il) + '&ilce=' + encodeURIComponent(ilce))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        aylikFiyat = d.aylik;
        tutarGuncelle();
        alanKutu.innerHTML = '';
        var bas = document.createElement('p');
        bas.className = 'alan-konum';
        bas.innerHTML = '<strong></strong> için reklam alanları:';
        bas.firstChild.textContent = d.konum;
        alanKutu.appendChild(bas);
        var ilkBos = null;
        d.alanlar.forEach(function (a) {
          var l = document.createElement('label');
          l.className = 'alan-secenek ' + (a.dolu ? 'dolu' : 'bos');
          var inp = document.createElement('input');
          inp.type = 'radio'; inp.name = 'slot'; inp.value = a.slot; inp.required = true; inp.disabled = a.dolu;
          if (!a.dolu && String(a.slot) === secili) inp.checked = true;
          if (!a.dolu && ilkBos === null) ilkBos = inp;
          var t = document.createElement('strong'); t.textContent = a.slot + '. Alan';
          var s = document.createElement('span');
          s.textContent = a.dolu ? 'Dolu · ' + a.bitis.split('-').reverse().join('.') + ' tarihine kadar' : (a.bekleyen ? 'Müsait · ' + a.bekleyen + ' başvuru var' : 'Müsait');
          l.appendChild(inp); l.appendChild(t); l.appendChild(s);
          alanKutu.appendChild(l);
        });
        if (!alanKutu.querySelector('input:checked') && ilkBos) ilkBos.checked = true;
        if (!ilkBos) {
          var p = document.createElement('p'); p.className = 'kucuk kirmizi';
          p.textContent = 'Bu bölgedeki 4 alanın tamamı dolu. Başka bir ilçe veya il geneli seçebilirsiniz.';
          alanKutu.appendChild(p);
        }
        alanKutu.querySelectorAll('input').forEach(function (i) {
          i.addEventListener('change', function () { alanKutu.setAttribute('data-secili', i.value); });
        });
      })
      .catch(function () { alanKutu.innerHTML = '<p class="kucuk">Alan bilgisi alınamadı.</p>'; });
  }
  if (alanKutu) {
    alanKutu.closest('form').querySelector('.js-ilce').addEventListener('change', alanlariGetir);
    alanlariGetir();
  }

  // İlan galerisi
  var galeri = document.querySelector('[data-galeri]');
  if (galeri) {
    var ana = galeri.querySelector('[data-galeri-ana]');
    var kucukler = [].slice.call(galeri.querySelectorAll('[data-galeri-src]'));
    var sayac = galeri.querySelector('[data-galeri-sayac]');
    var aktif = 0;
    var goster = function (i) {
      if (!kucukler.length) return;
      aktif = (i + kucukler.length) % kucukler.length;
      ana.src = kucukler[aktif].getAttribute('data-galeri-src');
      kucukler.forEach(function (k, j) { k.classList.toggle('secili', j === aktif); });
      if (sayac) sayac.textContent = (aktif + 1) + ' / ' + kucukler.length;
    };
    kucukler.forEach(function (k, i) { k.addEventListener('click', function () { goster(i); }); });
    var o = galeri.querySelector('[data-galeri-onceki]'), n = galeri.querySelector('[data-galeri-sonraki]');
    if (o) o.addEventListener('click', function () { goster(aktif - 1); });
    if (n) n.addEventListener('click', function () { goster(aktif + 1); });
    // Kaydırma (mobil)
    var x0 = null;
    galeri.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    galeri.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) goster(aktif + (dx < 0 ? 1 : -1));
      x0 = null;
    });
  }

  // Fotoğraf seçimi: sınır kontrolü + önizleme
  var fotoInput = document.querySelector('.js-foto');
  if (fotoInput) {
    var onizleme = document.getElementById('fotoOnizleme');
    fotoInput.addEventListener('change', function () {
      var max = parseInt(fotoInput.getAttribute('data-max'), 10);
      onizleme.innerHTML = '';
      if (fotoInput.files.length > max) {
        alert('En fazla ' + max + ' fotoğraf seçebilirsiniz.');
        fotoInput.value = '';
        return;
      }
      [].slice.call(fotoInput.files).forEach(function (f) {
        var img = document.createElement('img');
        img.alt = '';
        img.src = URL.createObjectURL(f);
        onizleme.appendChild(img);
      });
    });
  }

  // IBAN / referans kodu kopyalama
  document.querySelectorAll('[data-kopyala]').forEach(function (el) {
    el.addEventListener('click', function () {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(el.getAttribute('data-kopyala')).then(function () {
        el.classList.add('kopyalandi');
        setTimeout(function () { el.classList.remove('kopyalandi'); }, 1500);
      });
    });
  });

  // Şifre göster/gizle butonu
  document.querySelectorAll('input[type=password]').forEach(function (inp) {
    var kutu = document.createElement('span');
    kutu.className = 'sifre-kutu';
    inp.parentNode.insertBefore(kutu, inp);
    kutu.appendChild(inp);
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sifre-goster';
    b.setAttribute('aria-label', 'Şifreyi göster');
    b.setAttribute('aria-pressed', 'false');
    b.title = 'Şifreyi göster';
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<g class="goz"><path class="goz-dis" d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/>' +
      '<circle class="goz-bebek" cx="12" cy="12" r="3.2"/></g>' +
      '<line class="goz-cizgi" x1="3.5" y1="3.5" x2="20.5" y2="20.5"/></svg>';
    b.addEventListener('click', function () {
      var gizli = inp.type === 'password';
      inp.type = gizli ? 'text' : 'password';
      b.classList.toggle('acik', gizli);
      b.setAttribute('aria-pressed', gizli ? 'true' : 'false');
      b.setAttribute('aria-label', gizli ? 'Şifreyi gizle' : 'Şifreyi göster');
      b.title = gizli ? 'Şifreyi gizle' : 'Şifreyi göster';
      b.classList.remove('kirp'); void b.offsetWidth; b.classList.add('kirp');
      // imleci sona al, yazmaya devam edilebilsin
      var n = inp.value.length; inp.focus();
      try { inp.setSelectionRange(n, n); } catch (e) {}
    });
    kutu.appendChild(b);
  });

  // Şifre tekrarı eşleşiyor mu
  document.querySelectorAll('input[data-ayni]').forEach(function (tekrar) {
    var asil = tekrar.form && tekrar.form.querySelector('input[name="' + tekrar.getAttribute('data-ayni') + '"]');
    if (!asil) return;
    function kontrol() { tekrar.setCustomValidity(tekrar.value && tekrar.value !== asil.value ? 'Şifreler birbiriyle aynı değil.' : ''); }
    tekrar.addEventListener('input', kontrol);
    asil.addEventListener('input', kontrol);
  });

  // Telefonda açılır/kapanır filtre paneli
  document.querySelectorAll('[data-filtre-ac]').forEach(function (b) {
    var kutu = document.getElementById(b.getAttribute('aria-controls'));
    if (!kutu) return;
    b.addEventListener('click', function () {
      var acik = kutu.classList.toggle('acik');
      b.setAttribute('aria-expanded', acik ? 'true' : 'false');
    });
  });

  // Mesajda fotoğraf: önizleme, kaldırma, boş gönderimi engelleme
  var mf = document.querySelector('[data-mesaj-form]');
  if (mf) {
    var fi = mf.querySelector('[data-mesaj-foto]');
    var on = mf.querySelector('[data-foto-onizleme]');
    var ta = mf.querySelector('textarea');
    fi.addEventListener('change', function () {
      var f = fi.files && fi.files[0];
      if (!f) { on.hidden = true; return; }
      if (f.size > 10 * 1024 * 1024) { alertYok(); fi.value = ''; on.hidden = true; return; }
      on.querySelector('img').src = URL.createObjectURL(f);
      on.hidden = false;
    });
    function alertYok() { ta.setCustomValidity('Fotoğraf en fazla 10 MB olabilir.'); ta.reportValidity(); setTimeout(function () { ta.setCustomValidity(''); }, 2500); }
    on.querySelector('[data-foto-kaldir]').addEventListener('click', function () { fi.value = ''; on.hidden = true; });
    mf.addEventListener('submit', function (e) {
      if (!ta.value.trim() && !(fi.files && fi.files.length)) {
        e.preventDefault();
        ta.setCustomValidity('Bir mesaj yaz ya da fotoğraf ekle.');
        ta.reportValidity();
        setTimeout(function () { ta.setCustomValidity(''); }, 2500);
      }
    });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) mf.requestSubmit();
    });
  }

  // PWA: service worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }

  // Mesajlarda en alta kaydır
  var m = document.querySelector('.mesajlar');
  if (m) m.scrollTop = m.scrollHeight;

  var csrfAl = function () { var i = document.querySelector('input[name=_csrf]'); return i ? i.value : ''; };

  // ---- Canlı mesaj: yeni mesajlar sayfa yenilenmeden gelir, gönderim de yenilemeden olur ----
  var canli = document.querySelector('.mesajlar[data-canli]');
  if (canli) {
    var son = parseInt(canli.getAttribute('data-son'), 10) || 0;
    var sorguda = false;
    var sor = function () {
      if (sorguda) return Promise.resolve();
      sorguda = true;
      return fetch(canli.getAttribute('data-canli') + '?after=' + son, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.html) return;
          var altta = canli.scrollHeight - canli.scrollTop - canli.clientHeight < 80;
          var tmp = document.createElement('div');
          tmp.innerHTML = d.html;
          var bitis = canli.querySelector('#son');
          Array.prototype.forEach.call(tmp.querySelectorAll('.balon'), function (b) {
            if (!canli.querySelector('.balon[data-id="' + b.getAttribute('data-id') + '"]')) canli.insertBefore(b, bitis);
          });
          var bos = canli.querySelector('p.kucuk.merkez'); if (bos) bos.remove();
          son = d.son;
          if (altta) canli.scrollTop = canli.scrollHeight;
        })
        .catch(function () {})
        .then(function () { sorguda = false; });
    };
    setInterval(function () { if (!document.hidden) sor(); }, 4000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) sor(); });

    if (mf && window.fetch && window.FormData) {
      mf.addEventListener('submit', function (e) {
        if (e.defaultPrevented) return;
        e.preventDefault();
        var btn = mf.querySelector('button.btn');
        btn.disabled = true;
        fetch(mf.getAttribute('action') || location.pathname, { method: 'POST', body: new FormData(mf), credentials: 'same-origin', headers: { 'X-Canli': '1', Accept: 'application/json' } })
          .then(function (r) { return r.json().catch(function () { return { hata: 'Mesaj gönderilemedi.' }; }); })
          .then(function (d) {
            if (d.hata) { ta.setCustomValidity(d.hata); ta.reportValidity(); setTimeout(function () { ta.setCustomValidity(''); }, 3000); return; }
            ta.value = ''; fi.value = ''; on.hidden = true;
            return sor().then(function () { canli.scrollTop = canli.scrollHeight; });
          })
          .catch(function () { mf.submit(); })
          .then(function () { btn.disabled = false; ta.focus(); });
      });
    }
  }

  // ---- Zil ve mesaj sayacı: sayfa açıkken kendiliğinden güncellenir ----
  if (document.body.hasAttribute('data-canli-sayac') && window.fetch) {
    var rozetYaz = function (el, n, cls) {
      if (!el) return;
      var r = el.querySelector('.' + cls);
      if (!n) { if (r) r.remove(); return; }
      if (!r) { r = document.createElement('span'); r.className = cls; if (cls === 'rozet') el.appendChild(document.createTextNode(' ')); el.appendChild(r); }
      r.textContent = n > 99 ? '99+' : n;
    };
    var sayac = function () {
      fetch('/canli/sayac', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d) return;
          var zil = document.querySelector('.zil');
          if (zil) { zil.classList.toggle('var', d.bildirim > 0); rozetYaz(zil, d.bildirim, 'zil-sayi'); }
          rozetYaz(document.querySelector('[data-mesaj-link]'), d.mesaj, 'rozet');
        }).catch(function () {});
    };
    setInterval(function () { if (!document.hidden) sayac(); }, 25000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) sayac(); });
  }

  // ---- Telefona bildirim (Web Push) ----
  var pk = document.querySelector('[data-push]');
  if (pk && 'serviceWorker' in navigator && 'PushManager' in window && window.Notification) {
    var acBtn = pk.querySelector('[data-push-ac]');
    var kapatBtn = pk.querySelector('[data-push-kapat]');
    var metin = pk.querySelector('[data-push-metin]');
    var b64 = function (s) {
      var p = '='.repeat((4 - s.length % 4) % 4);
      var raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
      var out = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    };
    var gonderForm = function (url, alanlar) {
      var fd = new URLSearchParams(); fd.set('_csrf', csrfAl());
      Object.keys(alanlar).forEach(function (k) { fd.set(k, alanlar[k]); });
      return fetch(url, { method: 'POST', body: fd, credentials: 'same-origin', headers: { Accept: 'application/json' } });
    };
    var durum = function (sub) {
      var izinYok = Notification.permission === 'denied';
      acBtn.hidden = !!sub || izinYok;
      kapatBtn.hidden = !sub;
      if (sub) metin.textContent = '✅ Bu cihazda bildirimler açık.';
      else if (izinYok) metin.textContent = 'Bildirim izni tarayıcı ayarlarından kapatılmış. Açmak için adres çubuğundaki kilit simgesinden izin ver.';
    };
    pk.hidden = false;
    navigator.serviceWorker.ready.then(function (reg) {
      reg.pushManager.getSubscription().then(durum);
      acBtn.addEventListener('click', function () {
        acBtn.disabled = true;
        fetch('/push/anahtar', { credentials: 'same-origin' }).then(function (r) { return r.json(); })
          .then(function (d) { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(d.key) }); })
          .then(function (sub) { return gonderForm('/push/abone', { sub: JSON.stringify(sub) }).then(function () { durum(sub); }); })
          .catch(function () { durum(null); if (Notification.permission !== 'denied') metin.textContent = 'Bildirim açılamadı. Tarayıcın desteklemiyor olabilir (iPhone\'da önce siteyi ana ekrana ekle).'; })
          .then(function () { acBtn.disabled = false; });
      });
      kapatBtn.addEventListener('click', function () {
        reg.pushManager.getSubscription().then(function (sub) {
          if (!sub) return durum(null);
          return gonderForm('/push/iptal', { endpoint: sub.endpoint }).then(function () { return sub.unsubscribe(); }).then(function () { durum(null); metin.textContent = 'Bu cihazda bildirimler kapatıldı.'; });
        });
      });
    });
  }

  // ---- Paylaş: bağlantıyı kopyala, telefonun paylaş menüsü ----
  var pay = document.querySelector('[data-paylas]');
  if (pay) {
    var url = pay.getAttribute('data-url');
    var kop = pay.querySelector('[data-kopyala]');
    kop.addEventListener('click', function () {
      var bitti = function () { kop.classList.add('tamam'); kop.querySelector('span').textContent = 'Kopyalandı ✓'; setTimeout(function () { kop.classList.remove('tamam'); kop.querySelector('span').textContent = 'Bağlantıyı kopyala'; }, 2000); };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(bitti).catch(function () { window.prompt('Bağlantı:', url); });
      else window.prompt('Bağlantı:', url);
    });
    var yerel = pay.querySelector('[data-paylas-yerel]');
    if (navigator.share) {
      yerel.hidden = false;
      yerel.addEventListener('click', function () { navigator.share({ title: pay.getAttribute('data-baslik'), url: url }).catch(function () {}); });
    }
  }

  // Teklif formu: türe göre alanları göster
  var tf = document.querySelector('.teklif-form');
  if (tf) {
    var tTur = function () {
      var k = tf.querySelector('input[name=kind]:checked') || tf.querySelector('input[name=kind]');
      var takas = k && k.value === 'takas';
      var fa = tf.querySelector('.teklif-fiyat'); var ts = tf.querySelector('.teklif-takas-sec');
      if (fa) { fa.hidden = takas; fa.querySelector('input').required = !takas; var ip = tf.querySelector('#teklifIpucu'); if (ip) ip.hidden = takas; }
      if (ts) ts.hidden = !takas && !!fa;
    };
    tf.querySelectorAll('input[name=kind]').forEach(function (r) { r.addEventListener('change', tTur); });
    tTur();
  }
})();
