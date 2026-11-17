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
      fiyat.style.display = t && t.value === 'takas' ? 'none' : '';
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
    b.textContent = 'Göster';
    b.setAttribute('aria-label', 'Şifreyi göster');
    b.addEventListener('click', function () {
      var gizli = inp.type === 'password';
      inp.type = gizli ? 'text' : 'password';
      b.textContent = gizli ? 'Gizle' : 'Göster';
      b.setAttribute('aria-label', gizli ? 'Şifreyi gizle' : 'Şifreyi göster');
      inp.focus();
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

  // PWA: service worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }

  // Mesajlarda en alta kaydır
  var m = document.querySelector('.mesajlar');
  if (m) m.scrollTop = m.scrollHeight;
})();
