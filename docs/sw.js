// Service worker d'Andréa : garde l'application en réserve pour qu'elle s'ouvre même
// sans réseau. Les échanges avec l'API d'Anthropic ne passent jamais par ici.

const CACHE = "andrea-v1";
const SHELL = [
  "./", "index.html", "style.css", "manifest.webmanifest",
  "js/app.js", "js/brain.js", "js/calc.js", "js/markdown.js", "js/speech.js", "js/store.js", "js/tools.js",
  "vendor/anthropic-sdk.js", "icons/icon.svg", "icons/icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  // Réseau d'abord (toujours la dernière version), copie locale en secours.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })),
  );
});
