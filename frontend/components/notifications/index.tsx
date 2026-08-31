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
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { severityLabels, type AlertCause } from "@/lib/alert-causes";
import { CauseGroupPicker } from "./cause-group-picker";

export default function StopNotifications({
    stopName,
    routes,
    children,
    onChanged,
}: {
    stopName: string;
    routes: string[];
    children: ReactNode;
    /** Fires after a save or remove succeeds - lets a list of subscriptions elsewhere (e.g. the manage-notifications sheet) know to refetch. */
    onChanged?: () => void;
}) {
    const [checking, setChecking] = useState(true);
    const [alreadySubbed, setAlreadySubbed] = useState({ state: false, routes: [] as string[] });
    const [selectedRoutes, setSelectedRoutes] = useState<string[]>([]);
    const [causes, setCauses] = useState<AlertCause[]>([]);
    const [minSeverity, setMinSeverity] = useState("");
    const [notifyCancellations, setNotifyCancellations] = useState(true);
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
            setCauses((subbed.causes ?? []) as AlertCause[]);
            setMinSeverity(subbed.minSeverity ?? "");
            setNotifyCancellations(subbed.notifyCancellations ?? true);
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
            const filters = { causes, minSeverity, notifyCancellations };
            if (alreadySubbed.state) {
                const updated = await updateSubToStop(stopName, selectedRoutes, filters);
                if (updated) {
                    setAlreadySubbed({ state: true, routes: selectedRoutes });
                    toast.success(`Updated alerts for ${stopName}`);
                    onChanged?.();
                } else {
                    toast.error(`Failed to update alerts for ${stopName}`);
                }
            } else {
                const subbed = await subscribeToStop(stopName, selectedRoutes, filters);
                if (subbed) {
                    toast.success(`Alerts enabled for ${stopName} (${selectedRoutes.length} routes)`);
                    onChanged?.();
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedRoutes, causes, minSeverity, notifyCancellations]);

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

                        <div className="space-y-4 mt-4">
                            <div className="space-y-2">
                                <Label className="text-xs text-muted-foreground">Alert types (leave empty for all)</Label>
                                <CauseGroupPicker
                                    causes={causes}
                                    disabled={saving}
                                    onChange={(value) => {
                                        hasInteracted.current = true;
                                        setCauses(value);
                                    }}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label className="text-xs text-muted-foreground">Minimum severity</Label>
                                <Select
                                    value={minSeverity === "" ? "ANY" : minSeverity}
                                    onValueChange={(value) => {
                                        hasInteracted.current = true;
                                        setMinSeverity(value === "ANY" ? "" : value);
                                    }}
                                    disabled={saving}
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ANY">Any severity</SelectItem>
                                        <SelectItem value="WARNING">{severityLabels.WARNING} & above</SelectItem>
                                        <SelectItem value="SEVERE">{severityLabels.SEVERE} only</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="flex items-center justify-between rounded-lg border p-3">
                                <div className="space-y-0.5">
                                    <Label className="text-sm">Trip cancellations</Label>
                                    <p className="text-xs text-muted-foreground">Notify when a service is canceled</p>
                                </div>
                                <Switch
                                    checked={notifyCancellations}
                                    disabled={saving}
                                    onCheckedChange={(checked) => {
                                        hasInteracted.current = true;
                                        setNotifyCancellations(checked);
                                    }}
                                />
                            </div>
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
                                            onChanged?.();
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
                                                onChanged?.();
                                                setAlreadySubbed({ state: false, routes: [] });
                                                setSelectedRoutes([]);
                                                setCauses([]);
                                                setMinSeverity("");
                                                setNotifyCancellations(true);
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
