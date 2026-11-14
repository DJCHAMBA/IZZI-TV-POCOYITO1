const CACHE='izzi-tv-pocoyito-github-v1';
const CORE=['./','./index.html','./manifest.webmanifest','./icons/icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('izzi-tv-pocoyito-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const r=e.request,u=new URL(r.url);if(r.method!=='GET'||u.origin!==self.location.origin)return;e.respondWith(caches.match(r).then(c=>c||fetch(r).then(res=>{if(res.ok)caches.open(CACHE).then(x=>x.put(r,res.clone()));return res;}).catch(()=>caches.match('./index.html'))));});