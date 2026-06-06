// Kill-switch service worker.
//
// PoolPilot is a live control panel — it's useless without the backend, so an
// offline app-shell cache buys nothing and actively caused stale-bundle 404s
// after every deploy (cached old HTML pointing at hashed chunks that no longer
// exist). This SW ships no cache: it purges any caches a previous version made,
// unregisters itself, and reloads open windows so they come back clean from the
// network. Once it has run, the app has no service worker at all.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {
        /* ignore */
      }
      try {
        await self.registration.unregister();
      } catch {
        /* ignore */
      }
      try {
        const clients = await self.clients.matchAll({ type: "window" });
        for (const client of clients) client.navigate(client.url);
      } catch {
        /* ignore */
      }
    })(),
  );
});
