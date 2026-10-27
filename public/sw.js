const CACHE_NAME = "zecaid-pos-v2";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.add("/pos").catch(() => undefined);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("zecaid-pos-") && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const isStatic = url.pathname.startsWith("/_next/static/");
  const isNavigation = request.mode === "navigate" || url.pathname === "/pos";
  if (!isStatic && !isNavigation) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (isStatic) {
      const cached = await cache.match(request);
      if (cached) return cached;
    }
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch {
      const cached = await cache.match(request);
      if (cached) return cached;
      throw new Error("This page is not available offline.");
    }
  })());
});
