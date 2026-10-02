const CACHE_PREFIX = 'vtp-shell-';
const CACHE_NAME = __CACHE_NAME__;
const PRECACHE_URLS = __PRECACHE_URLS__;
const APP_ROOT_PATH = __APP_ROOT_PATH__;
const APP_INDEX_PATH = __APP_INDEX_PATH__;
const APP_RESULT_PATH = __APP_RESULT_PATH__;
const APP_ADMIN_PATH = __APP_ADMIN_PATH__;
const APP_INVENTORY_PATH = __APP_INVENTORY_PATH__;

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(PRECACHE_URLS);
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const cacheNames = await caches.keys();
        const previousCaches = cacheNames.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME);
        await Promise.all(previousCaches.map(name => caches.delete(name)));
        await self.clients.claim();

        if (previousCaches.length > 0) {
            const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            clients.forEach(client => client.postMessage({ type: 'VTP_APP_UPDATED' }));
        }
    })());
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const requestUrl = new URL(request.url);
    if (requestUrl.origin !== self.location.origin
        || requestUrl.pathname === '/api'
        || requestUrl.pathname.startsWith('/api/')) return;

    if (request.mode === 'navigate') {
        if (requestUrl.pathname !== APP_ROOT_PATH
            && requestUrl.pathname !== APP_INDEX_PATH
            && requestUrl.pathname !== APP_RESULT_PATH
            && requestUrl.pathname !== APP_ADMIN_PATH
            && requestUrl.pathname !== APP_INVENTORY_PATH) return;

        event.respondWith((async () => {
            try {
                const response = await fetch(request);
                if (response.ok) {
                    const cache = await caches.open(CACHE_NAME);
                    await cache.put(APP_INDEX_PATH, response.clone());
                }
                return response;
            } catch {
                const shell = await caches.match(APP_INDEX_PATH);
                return shell || Response.error();
            }
        })());
        return;
    }

    const precachedUrl = PRECACHE_URLS.find(url => new URL(url, self.location.origin).pathname === requestUrl.pathname);
    if (precachedUrl) {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            const cached = await cache.match(new URL(precachedUrl, self.location.origin).href, { ignoreVary: true });
            return cached || fetch(request);
        })());
    }
});