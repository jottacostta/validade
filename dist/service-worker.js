/* Service Worker mínimo do app Validade: não armazena respostas autenticadas em cache. */
self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {
    try { data = { body: event.data.text() }; } catch (_) { data = {}; }
  }
  var title = String(data.title || 'Alerta de validade');
  var options = {
    body: String(data.body || 'Há uma validade que requer atenção na sua loja.'),
    icon: new URL('./pwa-icon-192.png', self.registration.scope).href,
    badge: new URL('./pwa-icon-192.png', self.registration.scope).href,
    tag: String((data.data && data.data.registro_id) || data.tag || 'validade-alerta'),
    renotify: false,
    data: { url: new URL('./?tab=alertas', self.registration.scope).href }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = event.notification.data && event.notification.data.url || new URL('./?tab=alertas', self.registration.scope).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
    for (var i = 0; i < windows.length; i++) {
      if ('focus' in windows[i]) {
        return windows[i].navigate ? windows[i].navigate(target).then(function () { return windows[i].focus(); }) : windows[i].focus();
      }
    }
    return clients.openWindow(target);
  }));
});
