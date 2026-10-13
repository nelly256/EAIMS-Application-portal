(function () {
  'use strict';

  const toggle = document.getElementById('navToggle');
  const nav = document.getElementById('nav');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', () => nav.classList.toggle('open'));
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', () => nav.classList.remove('open'));
  });
}());
