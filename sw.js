// MacroTrack Service Worker
// Bump this version number with every deploy to force an immediate update
const VERSION = "mt-v7";
const CACHE = VERSION;

// Files to precache on install
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

// ── Install: cache core files ─────────────────────────────────────────────
self.addEventListener("install", function(e) {
  // Skip waiting immediately — don't wait for old SW to die
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(PRECACHE);
    })
  );
});

// ── Activate: delete old caches, claim all clients immediately ────────────
self.addEventListener("activate", function(e) {
  e.waitUntil(
    Promise.all([
      // Delete any old versioned caches
      caches.keys().then(function(keys) {
        return Promise.all(
          keys.filter(function(key) { return key !== CACHE; })
              .map(function(key) { return caches.delete(key); })
        );
      }),
      // Take control of all open tabs immediately
      self.clients.claim(),
    ]).then(function() {
      // Tell all open tabs to reload so they get the fresh version
      return self.clients.matchAll({ type: "window" }).then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ type: "SW_UPDATED", version: VERSION });
        });
      });
    })
  );
});

// ── Fetch: network-first for HTML, cache-first for everything else ─────────
self.addEventListener("fetch", function(e) {
  var url = new URL(e.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Network-first for HTML — always try to get the freshest version
  if (e.request.mode === "navigate" ||
      e.request.url.endsWith("index.html") ||
      e.request.url.endsWith("/")) {
    e.respondWith(
      fetch(e.request).then(function(networkRes) {
        // Got fresh from network — update cache and return
        var clone = networkRes.clone();
        caches.open(CACHE).then(function(cache) {
          cache.put(e.request, clone);
        });
        return networkRes;
      }).catch(function() {
        // Network failed — fall back to cache
        return caches.match(e.request).then(function(cached) {
          return cached || caches.match("./index.html");
        });
      })
    );
    return;
  }

  // Cache-first for static assets (icons, fonts, etc)
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(networkRes) {
        var clone = networkRes.clone();
        caches.open(CACHE).then(function(cache) {
          cache.put(e.request, clone);
        });
        return networkRes;
      });
    })
  );
});

// ── Push: handle incoming push notifications ──────────────────────────────
self.addEventListener("push", function(e) {
  var data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch (err) {
    data = { title: "MacroTrack", body: "You have a new notification" };
  }

  var title = data.title || "MacroTrack";
  var options = {
    body: data.body || "",
    icon: data.icon || "./icon-192.png",
    badge: data.badge || "./icon-192.png",
    data: { url: data.url || "./" },
    vibrate: [100, 50, 100],
    tag: data.tag || "macrotrack-notification",
    renotify: true,
  };

  e.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ── Notification click: open or focus the app ─────────────────────────────
self.addEventListener("notificationclick", function(e) {
  e.notification.close();

  var targetUrl = (e.notification.data && e.notification.data.url) || "https://kjgoodwin01.github.io/macrotrack/";

  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(clients) {
      // If app is already open, focus it
      for (var i = 0; i < clients.length; i++) {
        if (clients[i].url.indexOf("macrotrack") !== -1) {
          return clients[i].focus();
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow(targetUrl);
    })
  );
});
