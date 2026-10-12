const CACHE_PREFIX = "zhezhi-literature-";
const CACHE_NAME = `${CACHE_PREFIX}studio-20261012-2`;
const APP_SHELL = [
  "./index.html", "./manifest.webmanifest", "./icon.svg", "./novel-data/jinli.js?v=20261012-studio2",
  "./assets/site.css?v=20261012-studio2", "./assets/upgrade.css?v=20261012-studio2",
  "./assets/utils.js?v=20261012-studio2", "./assets/snapshots.js?v=20261012-studio2",
  "./assets/backup.js?v=20261012-studio2", "./assets/studio.js?v=20261012-studio2", "./assets/author.js?v=20261012-studio2",
  "./assets/catalog.js?v=20261012-studio2", "./assets/store.js?v=20261012-studio2", "./assets/writer.js?v=20261012-studio2", "./assets/app.js?v=20261012-studio2"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  // Prefer fresh content; only this release's cache is used while offline.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const key = request.mode === "navigate" ? "./index.html" : request;
    try {
      const response = await fetch(request, {cache: "no-cache"});
      if (response.ok) {
        try { await cache.put(key, response.clone()); } catch { /* Storage may be full. */ }
        return response;
      }
      return (await cache.match(key)) || response;
    } catch {
      return (await cache.match(key)) || new Response("离线内容尚未缓存，请连接网络后刷新。", {
        status: 503, headers: {"Content-Type": "text/plain; charset=utf-8"}
      });
    }
  })());
});
