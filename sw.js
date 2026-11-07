// author: claude
// 离线缓存：先用缓存，同时在后台更新。改版时把 VERSION 加一。
const VERSION = 'yixi-v13';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'audio.js', 'content.js', 'synth.js', 'render.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  // 人声片段从 voice/manifest.json 读出一并缓存，离线也能听
  e.waitUntil(caches.open(VERSION).then(async (c) => {
    await c.addAll(SHELL);
    try {
      const m = await (await fetch('voice/manifest.json', { cache: 'no-store' })).json();
      const files = Object.values(m.clips).flat().map((x) => x.file);
      await c.addAll(['voice/manifest.json', ...files]);
    } catch (err) { /* 没有人声文件时跳过 */ }
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
