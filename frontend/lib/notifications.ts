import { ApiFetch } from "./url-context";

/**
    Remove a subscription to a stop.

    ***Set stopIdOrName to "" to remove all subscriptions**
*/
export async function removeSubscription(stopIdOrName: string) {
    const sw = await navigator.serviceWorker.getRegistration("/pwa/sw.js")
    if (!sw) return false
    const subscription = await sw.pushManager.getSubscription()
    const form = new FormData();
    const sub = JSON.parse(JSON.stringify(subscription));
    form.set("endpoint", sub.endpoint);
    form.set("p256dh", sub.keys.p256dh);
    form.set("auth", sub.keys.auth);
    form.set("stopIdOrName", stopIdOrName);

    // Send subscription to the backend
    const response = await ApiFetch(`notifications/remove`, {
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

export async function register(swPath: string, options: RegistrationOptions) {
    if (swPath === "") {
        throw Error("No sw path provided")
    }
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register(swPath, options)
            const registered = await registration.update()
            console.log('SW registered: ', registered);
        } catch (error) {
            console.log('SW registration failed: ', error);
        }
    }
}

async function getSwRegistration() {
    let registration = await navigator.serviceWorker.getRegistration("/pwa/sw.js")
    if (!registration) {
        register("/pwa/sw.js", {})
        registration = await navigator.serviceWorker.getRegistration("/pwa/sw.js") as ServiceWorkerRegistration
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
    try {
        const response = await ApiFetch<NotificationClient>(`notifications/find-client`, {
            method: 'POST',
            body: form, // Don't manually set Content-Type here
        });
        if (response.ok) {
            const notificationClient = response.data
            const createdDate = new Date(notificationClient.Created * 1000);
            const currentDate = new Date();

            // Calculate the difference in milliseconds
            const diffInMilliseconds = currentDate.getTime() - createdDate.getTime();

            // Convert the difference to days
            const diffInDays = diffInMilliseconds / (1000 * 60 * 60 * 24);

            if (diffInDays > 29) {
                const newSubscription = await refreshSubscription()
                if (newSubscription.refreshed) {
                    return { has: true, subscription: newSubscription.subscription }
                } else {
                    return { has: false, subscription: undefined }
                }
            } else {
                return { has: true, subscription: subscription }
            }
        } else {
            return { has: false, subscription: undefined }
        }
    } catch (err) {
        console.error(err)
        return { has: false, subscription: undefined }
    }
}

export async function getCurrentPushSubscription(): Promise<{
    endpoint: string;
    auth: string;
    p256dh: string;
} | null> {
    const sw = await getSwRegistration()
    if (!sw) return null;

    const subscription = await sw.pushManager.getSubscription();
    if (!subscription) return null;

    const sub = JSON.parse(JSON.stringify(subscription));
    return {
        endpoint: sub.endpoint,
        auth: sub.keys.auth,
        p256dh: sub.keys.p256dh
    };
}

export async function addReminder(stopIdOrName: string, tripId: string, type: "arrival" | "get_off") {
    // eslint-disable-next-line prefer-const
    let subscription = await getCurrentPushSubscription();

    if (!subscription) {
        const hasNotificationPermission = getNotificationPermissionState()
        if (!hasNotificationPermission) {
            return false
        }
        const newSub = await createNewSubscription();
        const subObj = JSON.parse(JSON.stringify(newSub));
        subscription = {
            endpoint: subObj.endpoint,
            auth: subObj.keys.auth,
            p256dh: subObj.keys.p256dh
        };
    }

    const form = new FormData();
    form.set("endpoint", subscription.endpoint);
    form.set("p256dh", subscription.p256dh);
    form.set("auth", subscription.auth);
    form.set("stopIdOrName", stopIdOrName);
    form.set("tripId", tripId)
    form.set("type", type)

    // Send subscription to the backend
    try {
        const response = await ApiFetch(`notifications/reminder`, {
            method: 'POST',
            body: form,
        });

        if (response.ok) {
            return true
        }
        return false
    } catch (err) {
        console.error(err)
        return false
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
    try {
        const response = await ApiFetch(`notifications/add`, {
            method: 'POST',
            body: form, // Don't manually set Content-Type here
        });

        if (response.ok) {
            return true
        }
        return false
    } catch (err) {
        console.error(err)
        return false
    }
}

/**
 * Returns a boolean indicating if the refresh was successful or not
 */
export async function refreshSubscription(): Promise<{ refreshed: boolean; subscription: undefined | PushSubscription; }> {
    const { has, subscription } = await checkStopSubscription("")
    if (!has) {
        return { refreshed: false, subscription: undefined }
    }

    const oldSubscription = JSON.parse(JSON.stringify(subscription))

    const form = new FormData()
    form.set("old_endpoint", oldSubscription.endpoint)
    form.set("old_auth", oldSubscription.keys.auth)
    form.set("old_p256dh", oldSubscription.keys.p256dh)

    const newSub = await createNewSubscription()
    const newSubscription = JSON.parse(JSON.stringify(newSub))
    form.set("new_endpoint", newSubscription.endpoint)
    form.set("new_auth", newSubscription.keys.auth)
    form.set("new_p256dh", newSubscription.keys.p256dh)

    try {
        const req = await ApiFetch(`notifications/refresh`, {
            method: "POST",
            body: form
        })
        if (req.ok) {
            return { refreshed: true, subscription: newSub }
        }
        return { refreshed: false, subscription: undefined }
    } catch (err) {
        console.error(err)
        return { refreshed: false, subscription: undefined }
    }
}

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return new Uint8Array([...rawData].map((char) => char.charCodeAt(0)));
};


export interface NotificationClient {
    Id: number;
    Notification: Notification;
    RecentNotifications: string[];
    Created: number;
}

export interface Notification {
    endpoint: string;
    keys: Keys;
}

export interface Keys {
    auth: string;
    p256dh: string;
}

//TODO: remove function exports and make them all use this

const notification = {
    removeSubscription,
    unregister,
    register,
    getCurrentPushSubscription,
    checkStopSubscription,
    addReminder,
    subscribeToStop,
    refreshSubscription,
};

export default notification;
