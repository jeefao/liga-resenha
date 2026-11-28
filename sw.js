// Liga Resenha V6 — service worker
// Troque o número de CACHE a cada publicação.
// Os dados das ligas (Supabase, outro domínio) NUNCA passam por este cache.
const CACHE='liga-resenha-v6-pwa-28';
const ASSETS=['./','./index.html','./app.js','./app.css','./logo.png','./manifest.webmanifest','./vendor/supabase-2.119.0.js','./icon-192.png','./icon-512.png','./icon-maskable.png'];

self.addEventListener('install',e=>e.waitUntil(
  caches.open(CACHE)
    // cache:'reload' ignora o cache HTTP do navegador: garante arquivos da publicação atual
    .then(c=>c.addAll(ASSETS.map(u=>new Request(u,{cache:'reload'}))))
    .then(()=>self.skipWaiting())
));

self.addEventListener('activate',e=>e.waitUntil(
  caches.keys()
    .then(keys=>Promise.all(keys.filter(k=>k.startsWith('liga-resenha-')&&k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim())
));

self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;
  // Páginas e código do app: sempre tenta a versão
  // mais nova na internet; sem conexão, usa a guardada. A chave do cache ignora o "?..." do endereço.
  const u=new URL(req.url);u.search='';if(u.pathname.endsWith('/'))u.pathname+='index.html';
  const chave=u.href;
  if(req.mode==='navigate'||/\.(html|js|css|webmanifest)$/.test(u.pathname)&&!u.pathname.includes('/vendor/')){
    e.respondWith(
      fetch(req.url,{cache:'no-cache',credentials:'same-origin'})
        .then(r=>{
          if(r.ok){const copy=r.clone();e.waitUntil(caches.open(CACHE).then(c=>c.put(chave,copy)));}
          return r;
        })
        .catch(()=>caches.match(chave).then(r=>r||caches.match(new URL('./index.html',self.registration.scope).href)))
    );
    return;
  }
  e.respondWith(caches.match(req,{ignoreSearch:true}).then(r=>r||fetch(req)));
});
