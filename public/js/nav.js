(function () {
  'use strict';

  const toggle = document.getElementById('navToggle');
  const nav = document.getElementById('nav');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });
  nav.querySelectorAll('a').forEach((anchor) => {
    anchor.addEventListener('click', () => {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
}());
