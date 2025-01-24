/**
    Remove a subscription to a stop.

    ***Set stopIdOrName to "" to remove all subscriptions**
*/
export async function removeSubscription(stopIdOrName: string) {
    const sw = await navigator.serviceWorker.getRegistration("/sw.js")
    if (!sw) return false
    const subscription = await sw.pushManager.getSubscription()
    const form = new FormData();
    const sub = JSON.parse(JSON.stringify(subscription));
    form.set("endpoint", sub.endpoint);
    form.set("p256dh", sub.keys.p256dh);
    form.set("auth", sub.keys.auth);
    form.set("stopIdOrName", stopIdOrName);

    // Send subscription to the backend
    const response = await fetch(`${process.env.NEXT_PUBLIC_TRAINS}/at/notifications/remove`, {
        method: 'POST',
        body: form, // Don't manually set Content-Type here
    });
    if (response.ok) {
        return true
    } else {
        return false
    }
}

export function unregister() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(function (registration) {
            registration.unregister();
        });
    }
}

export function register(swPath: string, options: RegistrationOptions) {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker
            .register(swPath || '/service-worker.js', options)
            .then(function (registration) {
                registration.update().then((reg) => {
                    console.log('SW registered: ', reg);
                })
            })
            .catch(function (registrationError) {
                console.log('SW registration failed: ', registrationError);
            });
    }
}

async function getSwRegistration() {
    let registration = await navigator.serviceWorker.getRegistration("/sw.js")
    if (!registration) {
        register("/sw.js", {})
        registration = await navigator.serviceWorker.getRegistration("/sw.js") as ServiceWorkerRegistration
    }
    return registration
}

async function createNewSubscription() {
    const sw = await getSwRegistration()
    const newSubscription = await sw.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUB || ""),

    });
    return newSubscription
}

async function getNotificationPermissionState() {
    const sw = await getSwRegistration()
    const state = await sw.pushManager.permissionState({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUB || ""),

    })
    if (state === "granted") {
        return "can send"
    }
    if (state === "prompt") {
        return "ask"
    }
    return "cannot send"
}

/**
 * Check to see if a stop has a subscription for alerts
 * 
 * Set stopIdOrName to "" to check if there are any in general (finds first one in db with matching subscription data)
 */
export async function checkStopSubscription(stopIdOrName: string) {
    const sw = await getSwRegistration()
    if (!sw) return { has: false, subscription: undefined }

    const state = await getNotificationPermissionState()
    if (state === "cannot send") {
        return { has: false, subscription: undefined }
    }

    const subscription = await sw.pushManager.getSubscription()
    if (!subscription) {
        return { has: false, subscription: undefined }
    }

    const form = new FormData();
    const sub = JSON.parse(JSON.stringify(subscription));
    form.set("endpoint", sub.endpoint);
    form.set("p256dh", sub.keys.p256dh);
    form.set("auth", sub.keys.auth);
    form.set("stopIdOrName", stopIdOrName);

    // Send subscription to the backend
    const response = await fetch(`${process.env.NEXT_PUBLIC_TRAINS}/at/notifications/find-client`, {
        method: 'POST',
        body: form, // Don't manually set Content-Type here
    });
    if (response.ok) {
        return { has: true, subscription: subscription }
    } else {
        return { has: false, subscription: undefined }
    }
}

export async function subscribeToStop(stopIdOrName: string) {
    // eslint-disable-next-line prefer-const
    let { has, subscription } = await checkStopSubscription(stopIdOrName)

    if (!has) {
        const hasNotificationPermission = getNotificationPermissionState()
        if (!hasNotificationPermission) {
            return false
        }
        subscription = await createNewSubscription()
    }

    const form = new FormData();
    const sub = JSON.parse(JSON.stringify(subscription));
    form.set("endpoint", sub.endpoint);
    form.set("p256dh", sub.keys.p256dh);
    form.set("auth", sub.keys.auth);
    form.set("stopIdOrName", stopIdOrName);

    // Send subscription to the backend
    const response = await fetch(`${process.env.NEXT_PUBLIC_TRAINS}/at/notifications/add`, {
        method: 'POST',
        body: form, // Don't manually set Content-Type here
    });

    if (response.ok) {
        return true
    }
    return false
}

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return new Uint8Array([...rawData].map((char) => char.charCodeAt(0)));
};