// Buildermont service worker. scripts/build.mjs copies this to public/sw.js with the version below replaced by the build
// id (a hash of everything precached) and the two lists below by lists it generates, so a new build gets a new cache
// name, the old cache is dropped on activation (docs/MOBILE.md M1, M9), and no list here is kept by hand.
//
// The worker only ever touches the app shell and the art: play.html, the two bundles, the manifest, the icons and the
// atlas pages. Saves (`saves/…`), the bot API and source maps go straight to the network and are never cached, so the
// offline app can still talk to the install server when it is reachable (M10).
const VERSION = '2dfb761f99bc';
const CACHE = `buildermont-${VERSION}`;
/**
 * The atlas pages have a cache of their own that outlives a build. A page's name carries a hash of its bytes, so a page
 * that did not change between two builds is never downloaded twice, and a name found in the cache is always the right
 * picture.
 */
const ART_CACHE = 'buildermont-art';

// Everything is resolved against the registration scope, not the origin, so the app also works
// when it is served from a sub-path (https://host/buildermont/play.html).
const SCOPE = self.registration.scope;
const at = (p) => new URL(p, SCOPE).href;
const SHELL = at('play.html');
/** Generated: the app shell, and every atlas page a device draws from whatever its screen. */
const PRECACHE = ["play.html","app.js","sim-worker.js","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","icons/maskable-512.png","icons/apple-touch-icon.png","art/64-0.7001712c28.png","art/64-1.c9f43c7c6d.png","art/32-0.e0e669c268.png","art/ground/warp.79f5abe43c.png","art/ground/clump.b97d2e5e57.png","art/ground/tussock.8e800a0860.png","art/ground/blade.9d02d48cf5.png","art/ground/grit.0305662e9f.png","art/ground/erode.644fd4b62d.png"].map(at);
/**
 * Generated: every atlas page of this build. The largest mip's pages are not in PRECACHE — a phone that does not draw at
 * full sharpness never asks for them (docs/art/DESIGN.md D4) — and are kept in the art cache once a device that does
 * has fetched them.
 */
const ART = ["art/128-0.54d5b7dd6f.png","art/128-1.f3f336cf0b.png","art/128-2.4f28504aa1.png","art/128-3.729f1b027e.png","art/128-4.965ee6dd1d.png","art/128-5.fc4c796fce.png","art/64-0.7001712c28.png","art/64-1.c9f43c7c6d.png","art/32-0.e0e669c268.png","art/ground/warp.79f5abe43c.png","art/ground/clump.b97d2e5e57.png","art/ground/tussock.8e800a0860.png","art/ground/blade.9d02d48cf5.png","art/ground/grit.0305662e9f.png","art/ground/erode.644fd4b62d.png"].map(at);
const PRECACHE_SHELL = PRECACHE.filter((url) => !ART.includes(url));
const PRECACHE_ART = PRECACHE.filter((url) => ART.includes(url));

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // `cache: 'reload'` bypasses the HTTP cache: the precache must hold this build's bytes, never
      // whatever the browser kept from the previous visit.
      await cache.addAll(PRECACHE_SHELL.map((url) => new Request(url, { cache: 'reload' })));
      const art = await caches.open(ART_CACHE);
      const missing = [];
      for (const url of PRECACHE_ART) if (!(await art.match(url))) missing.push(url);
      await art.addAll(missing.map((url) => new Request(url, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('buildermont-') && name !== CACHE && name !== ART_CACHE) await caches.delete(name);
      }
      // The pages of earlier builds' art are dead weight: nothing will ask for them again.
      const art = await caches.open(ART_CACHE);
      for (const req of await art.keys()) if (!ART.includes(req.url)) await art.delete(req);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const target = url.origin + url.pathname; // the precache is keyed without query or hash

  if (req.mode === 'navigate') {
    // Only the offline page (and the scope root, which the install server maps to it) comes from
    // the cache. Other pages on the same origin -- the desktop index.html on the Node server when
    // the offline build is being tested there -- must keep loading from the network.
    if (target === SHELL || target === SCOPE) event.respondWith(shell(req));
    return;
  }
  if (ART.includes(target)) event.respondWith(artPage(req, target));
  else if (PRECACHE.includes(target)) event.respondWith(asset(req, target));
});

/** The app shell: cached play.html, the network when the cache is (still) empty. */
async function shell(req) {
  const cache = await caches.open(CACHE);
  return (await cache.match(SHELL)) ?? fetch(req);
}

/**
 * An atlas page: from the art cache when it is there — its name is its content, so it is never stale — otherwise from
 * the network, and kept for next time (and for offline).
 */
async function artPage(req, target) {
  const art = await caches.open(ART_CACHE);
  const hit = await art.match(target);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await art.put(target, res.clone());
  return res;
}

/**
 * A precached asset. Requests made by play.html (or with no referrer, as a launched PWA's can be)
 * are cache-first: that is what makes the app open offline. The same files requested by another
 * page of the origin -- the desktop page on a dev server that has this worker registered -- are
 * network-first so a rebuild shows up on the next reload instead of one reload later, with the
 * cache as the offline fallback.
 */
async function asset(req, target) {
  const cache = await caches.open(CACHE);
  const fromShell = !req.referrer || new URL(req.referrer).pathname === new URL(SHELL).pathname;
  if (fromShell) return (await cache.match(target)) ?? fetch(req);
  try {
    return await fetch(req);
  } catch (err) {
    const hit = await cache.match(target);
    if (hit) return hit;
    throw err;
  }
}
