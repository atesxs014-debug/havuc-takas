// Yönetim paneli: tema, mobil menü, hızlı geçiş (Ctrl+K), toplu seçim, tablo süzme
(function () {
  // Tema sayfa çizilmeden önce uygulanır (yanıp sönme olmasın)
  var KEY = 'havuc-yp-tema';
  var tema = null;
  try { tema = localStorage.getItem(KEY); } catch (e) {}
  if (!tema && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) tema = 'acik';
  if (tema === 'acik') document.documentElement.setAttribute('data-tema', 'acik');

  document.addEventListener('DOMContentLoaded', function () {
    var $ = function (s, k) { return (k || document).querySelector(s); };
    var $$ = function (s, k) { return Array.prototype.slice.call((k || document).querySelectorAll(s)); };

    // Tema düğmesi
    var temaBtn = $('#ypTema');
    if (temaBtn) temaBtn.addEventListener('click', function () {
      var acik = document.documentElement.getAttribute('data-tema') !== 'acik';
      if (acik) document.documentElement.setAttribute('data-tema', 'acik'); else document.documentElement.removeAttribute('data-tema');
      try { localStorage.setItem(KEY, acik ? 'acik' : 'koyu'); } catch (e) {}
    });

    // Mobil yan menü
    var yan = $('#ypYan'), perde = $('#ypPerde'), menu = $('#ypMenu');
    function menuAc(ac) {
      if (!yan) return;
      yan.classList.toggle('acik', ac);
      if (perde) perde.hidden = !ac;
      if (menu) menu.setAttribute('aria-expanded', ac ? 'true' : 'false');
    }
    if (menu) menu.addEventListener('click', function () { menuAc(!yan.classList.contains('acik')); });
    if (perde) perde.addEventListener('click', function () { menuAc(false); });

    // Hızlı geçiş paleti
    var palet = $('#ypPalet'), giris = $('#ypPaletGiris');
    var ogeler = palet ? $$('li', palet) : [];
    var sec = 0;
    var norm = function (s) { return (s || '').toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i'); };
    function gorunen() { return ogeler.filter(function (li) { return !li.hidden; }); }
    function isaretle() {
      var g = gorunen();
      ogeler.forEach(function (li) { li.classList.remove('secili'); li.setAttribute('aria-selected', 'false'); });
      if (g[sec]) { g[sec].classList.add('secili'); g[sec].setAttribute('aria-selected', 'true'); g[sec].scrollIntoView({ block: 'nearest' }); }
    }
    function suz() {
      var q = norm(giris.value.trim());
      ogeler.forEach(function (li) { li.hidden = q && norm(li.textContent).indexOf(q) === -1; });
      sec = 0; isaretle();
    }
    function paletAc() {
      if (!palet || palet.open) return;
      giris.value = ''; suz();
      if (palet.showModal) palet.showModal(); else palet.setAttribute('open', '');
      giris.focus();
    }
    function git(li) { if (li) window.location.href = li.getAttribute('data-git'); }
    if (palet) {
      $('#ypAraBtn').addEventListener('click', paletAc);
      giris.addEventListener('input', suz);
      giris.addEventListener('keydown', function (e) {
        var g = gorunen();
        if (e.key === 'ArrowDown') { sec = Math.min(g.length - 1, sec + 1); isaretle(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { sec = Math.max(0, sec - 1); isaretle(); e.preventDefault(); }
        else if (e.key === 'Enter') { git(g[sec]); e.preventDefault(); }
      });
      ogeler.forEach(function (li) {
        li.addEventListener('click', function () { git(li); });
        li.addEventListener('mousemove', function () { sec = gorunen().indexOf(li); isaretle(); });
      });
      palet.addEventListener('click', function (e) { if (e.target === palet) palet.close(); });
    }
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); paletAc(); }
      else if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) { e.preventDefault(); paletAc(); }
      else if (e.key === 'Escape') menuAc(false);
    });

    // Toplu seçim
    $$('[data-toplu]').forEach(function (form) {
      var kutular = function () { return $$('input[name=ids][form="' + form.id + '"]'); };
      var hepsi = $$('[data-hepsini-sec]').filter(function (h) { return form.contains(h) || h.getAttribute('data-hepsini-sec') === '#' + form.id; });
      var yazi = $('[data-secili-sayi]', form);
      var btnler = $$('[data-toplu-btn]', form);
      function guncelle() {
        var k = kutular(), n = k.filter(function (x) { return x.checked; }).length;
        if (yazi) yazi.textContent = n + ' seçili';
        btnler.forEach(function (b) { b.disabled = !n; });
        hepsi.forEach(function (h) { h.checked = n && n === k.length; h.indeterminate = n > 0 && n < k.length; });
      }
      hepsi.forEach(function (h) { h.addEventListener('change', function () { kutular().forEach(function (x) { x.checked = h.checked; }); guncelle(); }); });
      document.addEventListener('change', function (e) { if (e.target.matches && e.target.matches('input[name=ids]')) guncelle(); });
      guncelle();
    });

    // Filtre seçilince formu gönder
    $$('[data-otomatik-gonder]').forEach(function (s) { s.addEventListener('change', function () { s.form.submit(); }); });

    // Tabloyu yazdıkça süz
    $$('[data-tablo-suz]').forEach(function (inp) {
      var tablo = $(inp.getAttribute('data-tablo-suz'));
      if (!tablo) return;
      inp.addEventListener('input', function () {
        var q = norm(inp.value.trim());
        $$('tbody tr', tablo).forEach(function (tr) { tr.hidden = q && norm(tr.textContent).indexOf(q) === -1; });
      });
    });
  });
})();
