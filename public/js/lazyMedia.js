/**
 * public/js/lazyMedia.js
 * Lazy loading for images and videos using IntersectionObserver.
 * - Images: uses data-lazy-src attribute (falls back to loading="lazy" natively)
 * - Videos: pauses when off-screen, plays muted when in view, loads src on demand
 * - Called by initLazyMedia(root) — safe to call multiple times (idempotent)
 */
(function (global) {
  'use strict';

  // ── IntersectionObserver for images ───────────────────────────────────────
  const imageObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      const img = entry.target;
      const src = img.getAttribute('data-lazy-src');
      if (src) {
        img.src = src;
        img.removeAttribute('data-lazy-src');
        img.classList.add('lazy-loaded');
      }
      imageObserver.unobserve(img);
    });
  }, {
    rootMargin: '300px 0px', // Start loading 300px before visible
    threshold: 0
  });

  // ── IntersectionObserver for videos ───────────────────────────────────────
  const videoObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      const video = entry.target;

      if (entry.isIntersecting) {
        // Load src if not yet loaded
        const lazySrc = video.getAttribute('data-lazy-src');
        if (lazySrc && !video.src) {
          video.src = lazySrc;
          video.removeAttribute('data-lazy-src');
          video.load();
        }
        // Autoplay muted videos in view (like Facebook/TikTok)
        if (video.src && video.muted && video.paused && !video.hasAttribute('data-no-autoplay')) {
          const playPromise = video.play();
          if (playPromise && playPromise.catch) {
            playPromise.catch(function () { /* autoplay blocked — silent fail */ });
          }
        }
      } else {
        // Pause videos that scroll off screen
        if (!video.paused) {
          video.pause();
        }
      }
    });
  }, {
    rootMargin: '150px 0px',
    threshold: 0.2
  });

  /**
   * initLazyMedia(root)
   * Observes all lazy images and videos inside `root` (defaults to document).
   * Idempotent: elements already observed are skipped via data-lazy-observed.
   */
  function initLazyMedia(root) {
    var container = root || document;

    // Images with data-lazy-src
    container.querySelectorAll('img[data-lazy-src]:not([data-lazy-observed])').forEach(function (img) {
      img.setAttribute('data-lazy-observed', '1');
      imageObserver.observe(img);
    });

    // Add native loading="lazy" to plain images without explicit loading attr
    container.querySelectorAll('img:not([loading]):not([data-lazy-src])').forEach(function (img) {
      img.loading = 'lazy';
    });

    // Videos with data-lazy-src or existing src (pause/play on visibility)
    container.querySelectorAll('video[data-lazy-src]:not([data-lazy-observed]),' +
                               'video[src]:not([data-lazy-observed]):not([data-no-lazy])').forEach(function (video) {
      video.setAttribute('data-lazy-observed', '1');
      videoObserver.observe(video);
    });
  }

  // ── Auto-init on DOMContentLoaded ─────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initLazyMedia(document); });
  } else {
    initLazyMedia(document);
  }

  // Export for use in client.js
  global.initLazyMedia = initLazyMedia;

})(window);
