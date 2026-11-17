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

  // Mesajlarda en alta kaydır
  var m = document.querySelector('.mesajlar');
  if (m) m.scrollTop = m.scrollHeight;
})();
