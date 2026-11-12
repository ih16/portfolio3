'use strict';
const CACHE = 'ishtiaq-chat-shell-v7';
const SHELL = ['/chat', '/chat/inbox', '/chat/install', '/styles.css', '/chat/chat.css', '/chat/app.js', '/chat/icon-192.png', '/chat/icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(names => Promise.all(names.filter(name => name.startsWith('ishtiaq-chat-shell-') && name !== CACHE).map(name => caches.delete(name)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Only the public shell is cached. API responses and private messages never are.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !SHELL.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)));
    }
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || Response.error())));
});
self.addEventListener('push', event => {
  event.waitUntil(self.registration.showNotification('New chat message', {
    body: 'Someone sent you a message. Open your inbox to reply.',
    icon: '/chat/icon-192.png', badge: '/chat/badge.png', tag: 'ishtiaq-chat-inbox',
    data: { url: '/chat/inbox' }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const inbox = clients.find(client => new URL(client.url).pathname === '/chat/inbox');
    if (inbox) return inbox.focus();
    return self.clients.openWindow('/chat/inbox');
  }));
});
