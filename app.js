(function () {
  var tabs = document.querySelectorAll('[role="tab"]');
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      var group = tab.getAttribute('aria-controls');
      if (!group) return;
      var list = tab.parentElement;
      list.querySelectorAll('[role="tab"]').forEach(function (t) {
        t.classList.toggle('is-active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      var panelsRoot = list.parentElement.querySelector('.panels') || document;
      panelsRoot.querySelectorAll('[role="tabpanel"]').forEach(function (p) {
        var on = p.id === group;
        p.classList.toggle('is-active', on);
        if (on) p.removeAttribute('hidden');
        else p.setAttribute('hidden', '');
      });
    });
  });

  var y = document.getElementById('year');
  if (y) y.textContent = String(new Date().getFullYear());

  var toggle = document.querySelector('.mobile-nav-toggle');
  var nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
})();
