import PocketBase from "pocketbase";

export const pb = new PocketBase(process.env.NEXT_PUBLIC_PB_URL || "http://127.0.0.1:8090");

if (typeof window !== "undefined") {
    pb.authStore.loadFromCookie(document.cookie);
    pb.authStore.onChange(() => {
        document.cookie = pb.authStore.exportToCookie({ httpOnly: false });
    });
}