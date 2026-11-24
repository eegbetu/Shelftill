// Shelf & Till web version: keeps the app's own files on the phone so it opens without internet.
// Shop data is not handled here; Firebase keeps its own offline copy and syncs it.
const CACHE = "shelf-till-web-v1";
const CDN = /(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com|cdn\.jsdelivr\.net)$/;
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
const keep = (req, res) => { if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; };
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin && !CDN.test(url.hostname)) return; // sign-in and shop data go straight to Firebase
  if (req.mode === "navigate") {
    // The page itself: newest version when online, the saved copy when offline.
    e.respondWith(fetch(req).then(res => keep(new URL("./", self.location).href, res))
      .catch(() => caches.match(new URL("./", self.location).href).then(m => m || caches.match(req))));
    return;
  }
  // Scripts, styles, icons and fonts never change under the same name, so the saved copy is used first.
  e.respondWith(caches.match(req).then(m => m || fetch(req).then(res => keep(req, res))));
});
