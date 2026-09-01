// Minimal service worker — no caching, it only exists so the site meets
// Chrome's "installable as an app" criteria (required for the mobile share
// target in share.html to be reachable from the Android share sheet).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
