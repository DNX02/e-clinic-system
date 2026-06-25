const CACHE_NAME = "medical-mobile-v41";
const SHELL = [
  "/app-1-admin-panel",
  "/app-2-doctor",
  "/app-3-patient-survey",
  "/app-4-doctor-knowledge",
  "/app-5-nurse-knowledge",
  "/app-6-investor-dashboard",
  "/training.html",
  "/nurse-training.html",
  "/investor.html",
  "/styles.css",
  "/app.js?v=20260625g",
  "/admin.webmanifest",
  "/doctor.webmanifest",
  "/survey.webmanifest",
  "/icons/admin-icon.svg",
  "/icons/doctor-icon.svg",
  "/icons/survey-icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => caches.match(event.request))
  );
});












