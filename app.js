(function () {
  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) {
        t.classList.remove('is-active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('is-active');
      tab.setAttribute('aria-selected', 'true');
      var panels = document.querySelectorAll('.panel');
      panels.forEach(function (p) {
        var on = p.id === tab.getAttribute('aria-controls');
        p.classList.toggle('is-active', on);
        if (on) p.removeAttribute('hidden');
        else p.setAttribute('hidden', '');
      });
    });
  });

  // Optionally refresh version from GitHub latest release (no tracker; public API).
  // Fails silently offline so the hard-coded release still shows.
  fetch('https://api.github.com/repos/smartaislemenu/tytv-app/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' }
  }).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
    if (!data) return;
    var tag = (data.tag_name || '').replace(/^v/, '');
    if (tag) {
      var v1 = document.getElementById('rel-version');
      var v2 = document.getElementById('rel-version-2');
      if (v1) v1.textContent = tag;
      if (v2) v2.textContent = tag;
    }
    var body = data.body || '';
    var m = body.match(/sha256:\s*([a-f0-9]{64})/i);
    if (m) {
      var sha = document.getElementById('rel-sha');
      if (sha) {
        sha.textContent = m[1];
        sha.title = m[1];
      }
    }
    var asset = (data.assets || []).find(function (a) {
      return /TYTV\.apk$/i.test(a.name);
    });
    if (asset && asset.size) {
      // leave size label approximate; optional enhancement skipped to keep markup simple
    }
  }).catch(function () { /* keep static fallback */ });
})();
