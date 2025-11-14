import { ReactNode, useEffect, useState, useRef } from "react";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
    checkStopSubscription,
    removeSubscription,
    subscribeToStop,
    updateSubToStop,
} from "@/lib/notifications";
import { toast } from "sonner";
import LoadingSpinner from "@/components/loading-spinner";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export default function StopNotifications({
    stopName,
    routes,
    children,
}: {
    stopName: string;
    routes: string[];
    children: ReactNode;
}) {
    const [checking, setChecking] = useState(true);
    const [alreadySubbed, setAlreadySubbed] = useState({ state: false, routes: [] as string[] });
    const [selectedRoutes, setSelectedRoutes] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);

    const hasInteracted = useRef(false); // 🔹 tracks whether user changed something

    useEffect(() => {
        if (stopName === "") return;
        setAlreadySubbed({ state: false, routes: [] });
        setChecking(true);
        checkStopSubscription(stopName).then((subbed) => {
            if (subbed.has) {
                setAlreadySubbed({ state: true, routes: subbed.routes ?? [] });
                setSelectedRoutes(subbed.routes ?? []);
            } else {
                setSelectedRoutes([]);
            }
            setChecking(false);
            hasInteracted.current = false; // reset when reloading stop
        });
    }, [stopName]);

    const handleRouteToggle = (route: string) => {
        hasInteracted.current = true; // 🔹 mark that user changed something
        setSelectedRoutes((prev) =>
            prev.includes(route) ? prev.filter((r) => r !== route) : [...prev, route]
        );
    };

    const handleEnableOrUpdate = async () => {
        if (stopName === "") return;
        setSaving(true);
        try {
            if (alreadySubbed.state) {
                const updated = await updateSubToStop(stopName, selectedRoutes);
                if (updated) {
                    setAlreadySubbed({ state: true, routes: selectedRoutes });
                    toast.success(`Updated alerts for ${stopName}`);
                } else {
                    toast.error(`Failed to update alerts for ${stopName}`);
                }
            } else {
                const subbed = await subscribeToStop(stopName, selectedRoutes);
                if (subbed) {
                    toast.success(`Alerts enabled for ${stopName} (${selectedRoutes.length} routes)`);
                    setAlreadySubbed({ state: true, routes: selectedRoutes });
                } else {
                    toast.error(`Failed to enable alerts for ${stopName}`);
                }
            }
        } finally {
            setSaving(false);
        }
    };

    // 🔹 Auto-save only if user changed something (debounced)
    useEffect(() => {
        if (!hasInteracted.current) return; // skip initial load
        const timeout = setTimeout(() => {
            handleEnableOrUpdate();
        }, 1000);
        return () => clearTimeout(timeout);
    }, [selectedRoutes]);

    return (
        <Dialog>
            <DialogTrigger disabled={stopName === ""} asChild>
                {children}
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {alreadySubbed.state ? "Edit Alerts" : "Enable Alerts"}{" "}
                        <span className="text-blue-500">for {stopName}</span>
                    </DialogTitle>
                    <DialogDescription>
                        {alreadySubbed.state
                            ? "Your changes are saved automatically."
                            : "Select routes to receive notifications for delays or cancellations."}
                    </DialogDescription>
                </DialogHeader>

                {checking ? (
                    <LoadingSpinner height="200px" description="Checking..." />
                ) : (
                    <>
                        <div className="space-y-3 max-h-60 overflow-y-auto border rounded-lg p-3">
                            {routes.map((route) => (
                                <div key={route} className="flex items-center space-x-2">
                                    <Checkbox
                                        id={`route-${route}`}
                                        checked={selectedRoutes.includes(route)}
                                        onCheckedChange={() => handleRouteToggle(route)}
                                        disabled={saving}
                                    />
                                    <Label htmlFor={`route-${route}`}>{route}</Label>
                                </div>
                            ))}
                        </div>

                        {saving && (
                            <p className="text-sm text-muted-foreground mt-2">Saving changes...</p>
                        )}

                        <div className="flex items-center justify-between gap-2 mt-4">
                            <Button
                                variant="outline"
                                onClick={async (e) => {
                                    if (confirm("This will disable alerts for ALL stops.")) {
                                        e.currentTarget.disabled = true;
                                        const removed = await removeSubscription("");
                                        if (removed) {
                                            toast.success(`All notifications disabled`);
                                        } else {
                                            toast.error(`Failed to disable notifications`);
                                        }
                                    }
                                }}
                            >
                                Disable All Notifications
                            </Button>

                            <div className="flex items-center gap-2">
                                <DialogClose asChild>
                                    <Button variant="secondary">Close</Button>
                                </DialogClose>

                                {alreadySubbed.state ? (
                                    <Button
                                        variant="destructive"
                                        onClick={async (e) => {
                                            e.preventDefault();
                                            const removed = await removeSubscription(stopName);
                                            if (removed) {
                                                toast.info(`Notifications disabled for ${stopName}`);
                                                setAlreadySubbed({ state: false, routes: [] });
                                                setSelectedRoutes([]);
                                            } else {
                                                toast.error(
                                                    `Failed to disable notifications for ${stopName}`
                                                );
                                            }
                                        }}
                                    >
                                        Disable Alerts
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
