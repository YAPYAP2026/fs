// Service worker : l'application fonctionne hors ligne après une première visite.
// Réseau d'abord (les mises à jour arrivent dès qu'on est en ligne), cache en secours.
// « no-cache » : on revalide toujours auprès du serveur, sans se contenter du cache HTTP du navigateur.

const CACHE = "vr-v3";
const SHELL = [
  "./",
  "index.html",
  "css/style.css",
  "js/app.js",
  "js/animate.js",
  "js/descriptions.js",
  "js/designs.js",
  "js/figures.js",
  "js/formations.js",
  "js/skydiver.js",
  "js/snap.js",
  "js/storage.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || !req.url.startsWith("http")) return;
  e.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches
          .match(req, { ignoreSearch: true })
          .then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error())),
      ),
  );
});
