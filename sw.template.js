/* eslint-disable no-restricted-globals */
const CACHE_NAME = "envdiff-__VERSION__";
const PRECACHE = __PRECACHE__;
const DEFAULT_LOCALE = "__DEFAULT_LOCALE__";
const LOCALES = __LOCALES__;

const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

function localeFromAcceptLanguage(header) {
  if (!header) return DEFAULT_LOCALE;
  const parts = header.split(",");
  for (const part of parts) {
    const tag = part.trim().split(";")[0].trim().toLowerCase();
    if (!tag) continue;
    if (LOCALES.includes(tag)) return tag;
    const base = tag.split("-")[0];
    if (LOCALES.includes(base)) return base;
  }
  return DEFAULT_LOCALE;
}

function offlineStartPath(request) {
  const locale = localeFromAcceptLanguage(request.headers.get("Accept-Language"));
  return `/${locale}/`;
}

async function precacheAll() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    PRECACHE.map(async (url) => {
      try {
        await cache.add(url);
      } catch {
        /* skip missing optional assets */
      }
    }),
  );
}

async function cachePut(request, response) {
  if (!response || !response.ok) return response;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    return cachePut(request, response);
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const fallback = await caches.match(offlineStartPath(request));
      if (fallback) return fallback;
    }
    throw new Error("offline");
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  return cachePut(request, response);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheAll().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (FONT_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (url.pathname === "/" || url.pathname === "/index.html") {
    if (!self.navigator.onLine) {
      event.respondWith(
        Promise.resolve(
          Response.redirect(
            new URL(offlineStartPath(request), url.origin).href,
            302,
          ),
        ),
      );
    }
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
