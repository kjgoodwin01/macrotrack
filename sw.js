// MacroTrack Service Worker
// Bump this version number with every deploy to force an immediate update
const VERSION = "mt-v33";
const CACHE = VERSION;

// Files to precache on install
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

// CDN scripts to cache — fetched and stored on first install
// so repeat launches load React/ReactDOM/Supabase from cache, not the network
const CDN_CACHE = "mt-cdn-v2";
const CDN_PRECACHE = [
  "https://unpkg.com/react@18/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js",
];

// ── Install: cache core files + CDN scripts ───────────────────────────────
self.addEventListener("install", function(e) {
  // Skip waiting immediately — don't wait for old SW to die
  self.skipWaiting();
  e.waitUntil(
    Promise.all([
      caches.open(CACHE).then(function(cache) {
        return cache.addAll(PRECACHE);
      }),
      // Cache React/ReactDOM from CDN — these are big and don't change
      caches.open(CDN_CACHE).then(function(cache) {
        return Promise.all(CDN_PRECACHE.map(function(url) {
          return cache.match(url).then(function(hit) {
            if (hit) return; // already cached, skip the fetch
            return fetch(url, { mode: "cors" }).then(function(res) {
              if (res.ok) cache.put(url, res);
            }).catch(function() {}); // don't fail install if CDN is down
          });
        }));
      }),
    ])
  );
});

// ── Activate: delete old caches, claim all clients immediately ────────────
self.addEventListener("activate", function(e) {
  e.waitUntil(
    Promise.all([
      // Delete any old versioned caches (keep CDN cache — it's version-independent)
      caches.keys().then(function(keys) {
        return Promise.all(
          keys.filter(function(key) { return key !== CACHE && key !== CDN_CACHE; })
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

  // Serve cached CDN scripts (React, ReactDOM, Supabase) from cache-first
  if (url.hostname === "unpkg.com" || url.hostname === "cdnjs.cloudflare.com" || url.hostname === "cdn.jsdelivr.net") {
    e.respondWith(
      caches.open(CDN_CACHE).then(function(cache) {
        return cache.match(e.request).then(function(hit) {
          if (hit) return hit;
          return fetch(e.request).then(function(res) {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  // Only handle same-origin requests beyond this point
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
