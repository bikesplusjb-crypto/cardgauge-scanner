/* CardGauge Scanner — service worker

   Caches the shell so the app opens instantly and shows a useful screen
   even with no connection. Never caches API responses (prices must always
   be live), and never caches a failed response.

   ── THE UPDATE PROBLEM ──────────────────────────────────────────
   A PWA that cannot update is worse than no PWA. Anyone who installed
   this to their home screen kept running whatever version was cached the
   day they installed — fixes shipped all week and they never saw one,
   with no symptom to notice and nothing to click.

   Three things fix that, and all three are needed:

     1. CACHE_VERSION below is bumped on every deploy. Changing this file
        at all is what makes the browser install a new worker; a worker
        whose bytes are identical is never reinstalled.

     2. skipWaiting + clients.claim, so the new worker takes over at once
        instead of waiting for every tab to close — an installed app on a
        phone is almost never fully closed.

     3. The page is TOLD when the new worker takes control, so it can
        reload itself. Without this the user keeps looking at the old HTML
        until they happen to kill the app, which may be never.
   ──────────────────────────────────────────────────────────────── */

const CACHE_VERSION = 'v3-2026-08-02';
const CACHE = 'cardgauge-' + CACHE_VERSION;
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
    }).then(function () {
      return self.clients.claim();
    }).then(function () {
      // Tell any open pages that a new version is now in charge.
      return self.clients.matchAll({ type: 'window' }).then(function (list) {
        list.forEach(function (client) {
          client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
        });
      });
    })
  );
});

/* Lets the page ask which version is running — useful when somebody
   reports a bug and you need to know whether they're on current code. */
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'GET_VERSION' && e.source) {
    e.source.postMessage({ type: 'SW_VERSION', version: CACHE_VERSION });
  }
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
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

  var isNavigation = e.request.mode === 'navigate';
  var sameOrigin = false;
  try { sameOrigin = new URL(url).origin === self.location.origin; } catch (err) {}

  // Network-first so updates land immediately; fall back to cache offline.
  e.respondWith(
    fetch(e.request).then(function (res) {
      /* Only ever cache a response we can vouch for.

         Without this check a 404 or a 502 — which Render will hand you on a
         cold start or a bad deploy — gets written to the cache and then
         served to offline users indefinitely, long after the site is healthy
         again. Cross-origin responses (Google Fonts) come back opaque: they
         can't be inspected or validated, and they bill against the storage
         quota at padded size, so they're left alone too. */
      if (sameOrigin && res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) {
        if (hit) return hit;
        /* Only hand back the app shell for an actual page load. Returning
           HTML for a failed image or font request just produces a broken
           element with a confusing payload behind it. */
        if (isNavigation) return caches.match('/index.html');
        return Response.error();
      });
    })
  );
});
