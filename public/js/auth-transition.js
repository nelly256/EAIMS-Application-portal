'use strict';

(function () {
  const body = document.body;
  const transitionQuery = new URLSearchParams(window.location.search);
  const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (transitionQuery.get('authTransition') === 'flip') {
    transitionQuery.delete('authTransition');
    const query = transitionQuery.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
    );
    if (!isReducedMotion) body.classList.add('auth-flip-in');
  }

  let isNavigating = false;
  document.querySelectorAll('a[data-auth-flip]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.defaultPrevented
        || event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
        || link.target
        || link.hasAttribute('download')) {
        return;
      }

      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      event.preventDefault();
      if (isNavigating) return;
      isNavigating = true;

      if (isReducedMotion) {
        window.location.assign(destination.href);
        return;
      }

      destination.searchParams.set('authTransition', 'flip');
      body.classList.add('auth-flip-out');
      window.setTimeout(() => window.location.assign(destination.href), 600);
    });
  });
}());
