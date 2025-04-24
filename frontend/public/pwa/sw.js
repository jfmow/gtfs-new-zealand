self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('push', (event) => {
    let notification = event.data.json();

    const notificationOptions = {
        body: notification.body,
        icon: notification.icon,
        image: notification.image,
        badge: `/vehicle_icons/bus.png`,
        vibrate: notification.vibrate,
        tag: notification.tag,
        data: notification.data,
        actions: notification.actions,
        renotify: notification.renotify,
        requireInteraction: notification.requireInteraction,
        silent: notification.silent,
        timestamp: notification.timestamp,
        dir: notification.dir,
        lang: notification.lang
    };

    event.waitUntil(
        self.registration.showNotification(
            notification.title,
            notificationOptions
        )
    );
    navigator.setAppBadge(1)



});

self.addEventListener('notificationclick', function (event) {
    console.log('Notification clicked.');
    event.notification.close();

    let clickResponsePromise = Promise.resolve();
    if (event.notification.data && event.notification.data.url) {
        clickResponsePromise = clients.openWindow(event.notification.data.url);
    }

    event.waitUntil(clickResponsePromise);
});