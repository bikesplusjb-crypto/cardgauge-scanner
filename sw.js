/* CardGauge Scanner — service worker
   Caches the shell so the app opens instantly and shows a
   useful screen even with no connection. Never caches API
   responses (prices must always be live). */

const CACHE = 'cardgauge-v1';
const SHELL = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(SHELL).catch(function () { /* ignore individual misses */ });
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = e.request.url;

  // Never cache API calls, Supabase, or analytics — prices must be live.
  if (url.indexOf('/api/') > -1 ||
      url.indexOf('supabase.co') > -1 ||
      url.indexOf('analytics.tiktok.com') > -1 ||
      url.indexOf('ebay.com') > -1) {
    return;
  }

  if (e.request.method !== 'GET') return;

  // Network-first for the page itself so updates land immediately;
  // fall back to cache when offline.
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) {
        return hit || caches.match('/index.html');
      });
    })
  );
});
