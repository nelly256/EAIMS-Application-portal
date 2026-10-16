document.addEventListener('DOMContentLoaded', function () {
  var navToggle = document.getElementById('navToggle');
  var nav = document.getElementById('nav');

  if (navToggle && nav) {
    navToggle.addEventListener('click', function () {
      nav.classList.toggle('open');
    });
  }

  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function () {
      if (nav) {
        nav.classList.remove('open');
      }
    });
  });

  var countElements = document.querySelectorAll('.banner-number[data-count]');
  var animateCount = function (el, target) {
    var duration = 2000;
    var step = target / (duration / 16);
    var current = 0;
    var update = function () {
      current += step;
      if (current >= target) {
        el.textContent = target + '+';
      } else {
        el.textContent = Math.floor(current) + '+';
        requestAnimationFrame(update);
      }
    };
    update();
  };
  var startCounters = function () {
    countElements.forEach(function (el) {
      animateCount(el, parseInt(el.dataset.count, 10));
    });
  };
  startCounters();
  setInterval(startCounters, 20000);

  var slides = document.querySelectorAll('.hero-slider .slide');
  if (slides.length > 1) {
    var currentSlide = 0;
    slides[0].classList.add('active');
    setInterval(function () {
      slides[currentSlide].classList.remove('active');
      slides[currentSlide].classList.add('prev');
      currentSlide = (currentSlide + 1) % slides.length;
      slides[currentSlide].classList.add('active');
      setTimeout(function () {
        slides.forEach(function (s) {
          s.classList.remove('prev');
        });
      }, 1000);
    }, 5000);
  }
});
