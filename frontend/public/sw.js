self.addEventListener('push', event => {
    const data = event.data.json();
    console.log('Push received:', data);

    // Show notification
    self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/Favicon.png', // Provide an icon for the notification
    });
});
