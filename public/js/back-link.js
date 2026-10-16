document.querySelectorAll('[data-back]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = link.getAttribute('href') || '/';
    }
  });
});
