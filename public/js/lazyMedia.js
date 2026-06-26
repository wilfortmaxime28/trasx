/**
 * public/js/lazyMedia.js
 * Lazy loading for images and videos using IntersectionObserver.
 * - Adapts image quality to the current connection profile.
 * - Loads videos only when requested or when explicitly allowed.
 * - Safe to call multiple times through initLazyMedia(root).
 */
(function (global) {
  'use strict';

  function getConnectionProfile() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const effectiveType = String(connection?.effectiveType || '').toLowerCase();
    const saveData = Boolean(connection?.saveData);
    const downlink = Number(connection?.downlink || 0);
    const isSlow = saveData || effectiveType === 'slow-2g' || effectiveType === '2g' || (effectiveType === '3g' && downlink > 0 && downlink < 1.2);
    return {
      effectiveType,
      saveData,
      downlink,
      isSlow,
      imageTier: isSlow ? 'low' : (effectiveType === '3g' ? 'medium' : 'high'),
      feedBatchSize: isSlow ? 10 : 20
    };
  }

  function deriveResponsiveVariant(baseUrl, suffix) {
    const url = String(baseUrl || '');
    if (!/\/uploads\/posts\/opt-post-[^/]+\.webp$/i.test(url)) return null;
    return url.replace(/\.webp$/i, `-${suffix}.webp`);
  }

  function resolveImageSource(img) {
    const profile = global.__trasxConnectionProfile || getConnectionProfile();
    const explicitLow = img.getAttribute('data-lazy-src-low');
    const explicitMedium = img.getAttribute('data-lazy-src-medium');
    const explicitHigh = img.getAttribute('data-lazy-src-high');
    const mainSrc = img.getAttribute('data-lazy-src') || img.getAttribute('src') || '';

    const lowSrc = explicitLow || deriveResponsiveVariant(mainSrc, '240');
    const mediumSrc = explicitMedium || deriveResponsiveVariant(mainSrc, '480');
    const highSrc = explicitHigh || deriveResponsiveVariant(mainSrc, '720') || mainSrc;

    if (profile.imageTier === 'low' && lowSrc) return { preferred: lowSrc, fallback: mainSrc };
    if (profile.imageTier === 'medium' && mediumSrc) return { preferred: mediumSrc, fallback: mainSrc };
    return { preferred: highSrc || mainSrc, fallback: mainSrc };
  }

  function loadImage(img) {
    if (!img) return;
    const selected = resolveImageSource(img);
    const fallbackSrc = selected.fallback || img.getAttribute('data-lazy-src') || img.getAttribute('src') || '';
    const nextSrc = selected.preferred || fallbackSrc;

    if (nextSrc && img.getAttribute('src') !== nextSrc) {
      img.onerror = function () {
        if (fallbackSrc && img.getAttribute('src') !== fallbackSrc) {
          img.src = fallbackSrc;
        }
        img.onerror = null;
      };
      img.src = nextSrc;
    }

    img.removeAttribute('data-lazy-src');
    img.classList.add('lazy-loaded');
  }

  function ensureLazyVideoLoaded(video) {
    if (!video) return Promise.resolve(video);
    if (video.src || video.currentSrc) return Promise.resolve(video);

    const lazySrc = video.getAttribute('data-lazy-src');
    if (!lazySrc) return Promise.resolve(video);

    return new Promise((resolve) => {
      const finalize = () => {
        video.removeAttribute('data-lazy-src');
        video.removeEventListener('loadedmetadata', finalize);
        video.removeEventListener('loadeddata', finalize);
        resolve(video);
      };

      video.addEventListener('loadedmetadata', finalize, { once: true });
      video.addEventListener('loadeddata', finalize, { once: true });
      video.src = lazySrc;
      video.load();

      // Fallback for browsers that do not emit metadata immediately.
      setTimeout(finalize, 1500);
    });
  }

  const imageObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      loadImage(entry.target);
      imageObserver.unobserve(entry.target);
    });
  }, {
    rootMargin: '300px 0px',
    threshold: 0
  });

  const videoObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      const video = entry.target;

      if (!entry.isIntersecting) {
        if (!video.paused) video.pause();
        return;
      }

      if (video.hasAttribute('data-load-on-play')) return;

      ensureLazyVideoLoaded(video).then(function () {
        if (video.hasAttribute('data-no-autoplay')) return;
        if (video.src && video.muted && video.paused) {
          const playPromise = video.play();
          if (playPromise && playPromise.catch) {
            playPromise.catch(function () {});
          }
        }
      });
    });
  }, {
    rootMargin: '180px 0px',
    threshold: 0.15
  });

  function initLazyMedia(root) {
    var container = root || document;

    global.__trasxConnectionProfile = getConnectionProfile();
    global.__trasxFeedBatchSize = global.__trasxConnectionProfile.feedBatchSize;

    container.querySelectorAll('img[data-lazy-src]:not([data-lazy-observed])').forEach(function (img) {
      img.setAttribute('data-lazy-observed', '1');
      imageObserver.observe(img);
    });

    container.querySelectorAll('img:not([loading])').forEach(function (img) {
      img.loading = 'lazy';
      img.decoding = 'async';
    });

    container.querySelectorAll('video[data-lazy-src]:not([data-lazy-observed]), video[src]:not([data-lazy-observed]):not([data-no-lazy])').forEach(function (video) {
      video.setAttribute('data-lazy-observed', '1');
      videoObserver.observe(video);
    });
  }

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection && typeof connection.addEventListener === 'function') {
    connection.addEventListener('change', function () {
      global.__trasxConnectionProfile = getConnectionProfile();
      global.__trasxFeedBatchSize = global.__trasxConnectionProfile.feedBatchSize;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initLazyMedia(document); });
  } else {
    initLazyMedia(document);
  }

  global.ensureLazyVideoLoaded = ensureLazyVideoLoaded;
  global.initLazyMedia = initLazyMedia;
})(window);
