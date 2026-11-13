// Fiber911 Panel Guide — offline shell cache. Bump VERSION when you upload a new index.html.
const VERSION = "panels-v6";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("panels-") && !k.startsWith(VERSION)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.hostname.includes("script.google") || url.hostname.includes("googleusercontent")) return;
  if (url.origin === location.origin && /\/otdr\/?$/.test(url.pathname)) return; // MaxTester upload page: always live
  // page: network first so updates show, cache fallback for offline
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put("./index.html", c)); return r; })
      .catch(() => caches.match("./index.html")));
    return;
  }
  // everything else (Leaflet, map tiles): cache first, then network
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok && (url.hostname.includes("unpkg") || url.hostname.includes("tile") || url.hostname.includes("arcgisonline"))) {
      const c = r.clone(); caches.open(VERSION + "-tiles").then(x => x.put(e.request, c));
    }
    return r;
  })));
});
