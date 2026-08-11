/**
 * URDiary service worker (v2.3 task 2.2).
 *
 * Scope is the whole app ("/") — this file is served from the origin root
 * by backend/app/main.py's explicit /sw.js route, with Cache-Control:
 * no-cache so the browser always revalidates it against the network before
 * deciding whether a new version needs installing.
 *
 * Responsibilities:
 *   - Precache the app shell (html/css/js/icons/vendored fonts+icons) under
 *     a versioned cache name.
 *   - Never cache API responses — network-only for the path prefixes listed
 *     in js/sw_logic.js (shared with the page so main.js's update-prompt
 *     logic and this file's routing logic can't drift apart).
 *   - Cache-first for shell assets.
 *   - Offline fallback: failed navigations fall back to the cached
 *     index.html.
 *   - Updates never swap the app mid-session: `install` does NOT call
 *     skipWaiting(). The new worker sits in `waiting` until js/main.js's
 *     "new version available" prompt gets an explicit user accept, which
 *     posts {type: 'SKIP_WAITING'} — only then does this worker call
 *     self.skipWaiting() and let the page reload onto it.
 */

importScripts('/js/sw_logic.js');

const CACHE_VERSION = 'urdiary-shell-v1';

// App shell: every file the running app actually loads. Keep this in sync
// with index.html's <link>/<script> tags and manifest.webmanifest's icons —
// nothing here is discovered automatically (no build step to do that for
// us), so a file added to the page without being added here just won't be
// available offline (fails soft: falls through to network, doesn't break).
//
// Deliberately NOT '/index.html': backend/app/main.py only registers a
// route at '/' (serve_frontend_index) — there is no separate '/index.html'
// route, it 404s. cache.addAll() is all-or-nothing: a single 404 in this
// list fails the ENTIRE install, silently, every time (this shipped once —
// see task-2.2-report.md's fix log). Same reason the offline-navigation
// fallback below matches against '/', not '/index.html'.
const SHELL_ASSETS = [
    '/',
    '/manifest.webmanifest',
    '/favicon.ico',

    '/css/styles.css',
    '/css/base.css',
    '/css/animations.css',
    '/css/chat.css',
    '/css/diary.css',
    '/css/calendar.css',
    '/css/components.css',

    '/js/security_utils.js',
    '/js/i18n.js',
    '/js/config.js',
    '/js/error_logger.js',
    '/js/secure_store.js',
    '/js/api_service.js',
    '/js/settings_module.js',
    '/js/sw_logic.js',
    '/js/ui_manager.js',
    '/js/chat_module.js',
    '/js/diary_module.js',
    '/js/calendar_module.js',
    '/js/main.js',

    '/assets/icon.jpg',
    '/assets/default-avatar.jpg',
    '/assets/icons/icon-192.png',
    '/assets/icons/icon-512.png',
    '/assets/icons/icon-maskable-512.png',
    '/assets/icons/apple-touch-icon-180.png',

    '/assets/vendor/fonts/fonts.css',
    '/assets/vendor/fonts/noto-sans-tc-400.woff2',
    '/assets/vendor/fonts/noto-sans-tc-500.woff2',
    '/assets/vendor/fonts/noto-sans-tc-700.woff2',
    '/assets/vendor/fontawesome/fontawesome-subset.css',
    '/assets/vendor/fontawesome/webfonts/fa-solid-900.woff2'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_VERSION).then(function (cache) {
            return cache.addAll(SHELL_ASSETS);
        })
    );
    // Deliberately not forcing this worker to activate here — it stays in
    // `waiting` until the user accepts the update prompt. See file header.
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (names) {
            return Promise.all(
                names
                    .filter(function (name) { return name !== CACHE_VERSION; })
                    .map(function (name) { return caches.delete(name); })
            );
        }).then(function () {
            // clients.claim() runs here in BOTH cases activate can be
            // reached: the very first install (no prior controller — the
            // browser activates automatically, nothing waited for
            // skipWaiting) and an accepted update (skipWaiting() was just
            // called from the message handler below). Claiming immediately
            // hands control of any already-open page to this worker rather
            // than waiting for that page's next navigation.
            //
            // That means a first install DOES fire a `controllerchange` on
            // the already-open page — that's expected and harmless on its
            // own. What makes it harmless is on the page side
            // (js/main.js's initServiceWorker): the reload-on-
            // controllerchange listener is only ever armed inside the
            // update prompt's accept handler, never at registration time.
            // So this claim() firing controllerchange during a first
            // install has nothing listening for it — no reload, no
            // disruption. Don't "fix" a first-install reload by removing
            // clients.claim(); fix it on the listener side, which is
            // exactly what SWLogic.createControllerChangeReloadArmer is
            // for. See task-2.2-report.md's fix log for the incident this
            // comment is guarding against.
            return self.clients.claim();
        })
    );
});

// js/main.js posts this after the user accepts the "new version available"
// prompt. Until then the new worker just waits — this is the only path
// that can make an update take over an already-open page.
self.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('fetch', function (event) {
    const request = event.request;

    // Only GET is ever intercepted. POST/PUT/DELETE (chat messages, diary
    // edits, calendar mutations, …) fall through untouched — no
    // respondWith() call means the browser handles them exactly as if this
    // service worker didn't exist, i.e. network-only.
    if (request.method !== 'GET') {
        return;
    }

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) {
        // Never true today (CSP is default-src 'self', no cross-origin
        // requests exist in this app) — kept as an explicit boundary so a
        // future third-party request doesn't silently start flowing
        // through this cache logic.
        return;
    }

    // Classify BEFORE branching on request.mode: API paths (/docs included)
    // must stay strictly network-only even for a navigation-mode request
    // (e.g. someone typing /docs into the address bar while offline) —
    // there must be no path through which an "offline fallback" ends up
    // serving a cached response, or a synthesized one, for an API route.
    const strategy = self.SWLogic.classifyRequestPath(url.pathname);

    if (strategy === 'network-only') {
        event.respondWith(fetch(request));
        return;
    }

    // strategy === 'cache-first' from here on (shell paths only).
    //
    // Navigations (typing the URL, reloading, opening the installed PWA —
    // in practice always "/", since start_url/scope are both "/" and the
    // app never changes the URL client-side) prefer a fresh network copy
    // first — the server sends index.html with Cache-Control: no-cache for
    // the same reason, so a shell change is picked up on the very next
    // reload — and only fall back to the cached shell copy when the
    // network is unreachable.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).catch(function () {
                // '/' is the cache key that's actually precached (see
                // SHELL_ASSETS above) — it's also the only URL a navigation
                // in this app ever targets (start_url/scope are both '/').
                return caches.match('/');
            })
        );
        return;
    }

    // Non-navigation shell assets (css/js/icons/fonts): simple cache-first.
    // These are versioned together with the service worker itself (a new
    // CACHE_VERSION precaches fresh copies of all of them), so staleness is
    // bounded by the update flow rather than by re-checking the network on
    // every single request.
    event.respondWith(
        caches.match(request).then(function (cached) {
            if (cached) {
                return cached;
            }
            return fetch(request).then(function (response) {
                if (response && response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_VERSION).then(function (cache) {
                        cache.put(request, copy);
                    });
                }
                return response;
            });
        })
    );
});
