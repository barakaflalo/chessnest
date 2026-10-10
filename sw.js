/* ── AppNest · Cloudflare Pages fix (Oct 2026) ──
   Cloudflare redirects *.html to clean URLs (/index.html -> /). Chrome refuses a
   "redirected" response that a Service Worker hands to a page load (ERR_FAILED).
   This strips the redirect flag from every response the SW fetches or reads from cache. */
(function(){
  var NB={101:1,204:1,205:1,304:1};
  function clean(r){
    if(!r||!r.redirected||NB[r.status])return r;
    return r.blob().then(function(b){return new Response(b,{status:r.status,statusText:r.statusText,headers:r.headers});});
  }
  var _fetch=self.fetch.bind(self);
  self.fetch=function(input,init){
    if(input&&typeof input==='object'&&input.mode==='navigate')input=input.url;
    return _fetch(input,init).then(clean);
  };
  var cm=Cache.prototype.match;
  Cache.prototype.match=function(){return cm.apply(this,arguments).then(clean);};
  var sm=CacheStorage.prototype.match;
  CacheStorage.prototype.match=function(){return sm.apply(this,arguments).then(clean);};
})();

/* ChessNest service worker — bump VERSION on every upload */
const VERSION = 'chessnest-v2';
/* the drawings live in their own cache: an app update doesn't download 3 MB of art again.
   Replacing a drawing under the same file name → change ART to a new name (cnart-2). */
const ART = 'cnart-1';
const SHELL = ['./', 'manifest.json', 'icon-192.png', 'icon-512.png', 'privacy_policy.html'];
// the default set (idle poses) is ready offline from the first install; everything else under img/ is cached on first use
const ART_PRE = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'].map(n => 'img/kingdom/' + n + '.webp');
const ROOT = new URL('./', self.registration.scope).href;

self.addEventListener('install', e => {
  // each file on its own: one failure (weak network) must not leave the cache empty
  e.waitUntil(caches.open(VERSION).then(c => Promise.allSettled(SHELL.map(u => fetch(u, { cache: 'reload' }).then(r => (r && r.ok ? c.put(u, r) : null)))))
    .then(() => caches.open(ART)).then(c => Promise.allSettled(ART_PRE.map(u => c.match(u).then(hit => hit || fetch(u).then(r => (r && r.ok ? c.put(u, r) : null))))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => (k.startsWith('chessnest-') && k !== VERSION) || (k.startsWith('cnart-') && k !== ART)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const OFFLINE = '<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ChessNest</title>' +
  '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0a10;color:#f3efe4;font-family:system-ui,sans-serif;text-align:center;padding:24px">' +
  '<div><div style="font-size:54px">♞</div><h1 style="font-weight:400">ChessNest</h1><p>אין חיבור לאינטרנט כרגע. · No connection right now.</p>' +
  '<button onclick="location.reload()" style="min-height:48px;padding:10px 22px;border-radius:12px;border:1.5px solid #d4a940;background:#d4a940;color:#140f02;font-size:17px;font-weight:700">נסה שוב · Retry</button></div></body></html>';
const offlinePage = () => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

function withTimeout(p, ms) { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); }); }
/* the app's own page: only the root URL (or root/index.html) is ever stored, as './' */
const isRoot = url => { const u = url.split('#')[0].split('?')[0]; return u === ROOT || u === ROOT + 'index.html' || u === ROOT + 'index'; };

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                         // CDN, PeerJS, fonts: straight to the network
  if (req.mode === 'navigate') {
    // network first (4 s), then the cached app, then a friendly offline page — never an error
    e.respondWith(withTimeout(fetch(req.url), 4000).then(r => {
      if (r && r.ok && isRoot(req.url)) { const copy = r.clone(); caches.open(VERSION).then(c => c.put('./', copy)); }
      return r;
    }).catch(() => caches.match(isRoot(req.url) ? './' : req.url, { ignoreSearch: true }).then(r => r || caches.match('./')).then(r => r || offlinePage())));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(r => {
    if (r && r.ok && SHELL.some(s => s !== './' && url.pathname.endsWith('/' + s))) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    else if (r && r.ok && url.pathname.includes('/img/')) { const copy = r.clone(); caches.open(ART).then(c => c.put(req, copy)); }
    return r;
  })));
});
