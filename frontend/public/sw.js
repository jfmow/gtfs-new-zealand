self.addEventListener('push', (event) => {
    let notification = event.data.json();

    const notificationOptions = {
        title: notification.title,
        body: notification.body,
        icon: notification.icon,
        image: notification.image,
        badge: notification.badge,
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

    self.registration.showNotification(
        notification.title,
        notificationOptions
    );
});