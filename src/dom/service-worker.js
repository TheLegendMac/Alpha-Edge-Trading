// Service worker registration — installs sw.js and forces an update check
// on each load. Extracted from an inline <script> in index.html.

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js?v=2').then(reg => {
      reg.update();
    }).catch(err => {
      console.log('ServiceWorker registration failed: ', err);
    });
  });
}
