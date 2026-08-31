import { ReactNode, useEffect, useRef, useState } from "react";
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
    checkRouteSubscription,
    removeRouteSubscription,
    subscribeToRoute,
    updateRouteSub,
} from "@/lib/notifications";
import { toast } from "sonner";
import LoadingSpinner from "@/components/loading-spinner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { severityLabels, type AlertCause } from "@/lib/alert-causes";
import { CauseGroupPicker } from "./cause-group-picker";

/** Same shape as StopNotifications, but scoped to a single route with no stop involved - "follow this route everywhere." */
export default function RouteNotifications({
    routeId,
    children,
    onChanged,
}: {
    routeId: string;
    children: ReactNode;
    /** Fires after a save or remove succeeds - lets a list of subscriptions elsewhere (e.g. the manage-notifications sheet) know to refetch. */
    onChanged?: () => void;
}) {
    const [checking, setChecking] = useState(true);
    const [alreadySubbed, setAlreadySubbed] = useState(false);
    const [causes, setCauses] = useState<AlertCause[]>([]);
    const [minSeverity, setMinSeverity] = useState<string>("");
    const [notifyCancellations, setNotifyCancellations] = useState(true);
    const [saving, setSaving] = useState(false);

    const hasInteracted = useRef(false);

    useEffect(() => {
        if (routeId === "") return;
        setChecking(true);
        checkRouteSubscription(routeId).then(({ has, subscription }) => {
            setAlreadySubbed(has);
            setCauses((subscription?.causes ?? []) as AlertCause[]);
            setMinSeverity(subscription?.min_severity ?? "");
            setNotifyCancellations(subscription?.notify_cancellations ?? true);
            setChecking(false);
            hasInteracted.current = false;
        });
    }, [routeId]);

    const handleEnableOrUpdate = async () => {
        if (routeId === "") return;
        setSaving(true);
        try {
            const filters = { causes, minSeverity, notifyCancellations };
            const ok = alreadySubbed
                ? await updateRouteSub(routeId, filters)
                : await subscribeToRoute(routeId, filters);
            if (ok) {
                setAlreadySubbed(true);
                toast.success(alreadySubbed ? `Updated alerts for ${routeId}` : `Alerts enabled for ${routeId}`);
                onChanged?.();
            } else {
                toast.error(`Failed to save alerts for ${routeId}`);
            }
        } finally {
            setSaving(false);
        }
    };

    useEffect(() => {
        if (!hasInteracted.current) return;
        const timeout = setTimeout(() => {
            handleEnableOrUpdate();
        }, 1000);
        return () => clearTimeout(timeout);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [causes, minSeverity, notifyCancellations]);

    return (
        <Dialog>
            <DialogTrigger disabled={routeId === ""} asChild onClick={(e) => e.stopPropagation()}>
                {children}
            </DialogTrigger>
            <DialogContent onClick={(e) => e.stopPropagation()}>
                <DialogHeader>
                    <DialogTitle>
                        {alreadySubbed ? "Edit Alerts" : "Enable Alerts"}{" "}
                        <span className="text-blue-500">for route {routeId}</span>
                    </DialogTitle>
                    <DialogDescription>
                        Follows this route everywhere, no matter which stop is affected. Changes save automatically.
                    </DialogDescription>
                </DialogHeader>

                {checking ? (
                    <LoadingSpinner height="200px" description="Checking..." />
                ) : (
                    <>
                        <div className="space-y-4">
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
                                    <p className="text-xs text-muted-foreground">Notify when a service on this route is canceled</p>
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

                        <div className="flex items-center justify-end gap-2 mt-4">
                            <DialogClose asChild>
                                <Button variant="secondary">Close</Button>
                            </DialogClose>

                            {alreadySubbed ? (
                                <Button
                                    variant="destructive"
                                    onClick={async (e) => {
                                        e.preventDefault();
                                        const removed = await removeRouteSubscription(routeId);
                                        if (removed) {
                                            toast.info(`Notifications disabled for route ${routeId}`);
                                            onChanged?.();
                                            setAlreadySubbed(false);
                                            setCauses([]);
                                            setMinSeverity("");
                                            setNotifyCancellations(true);
                                        } else {
                                            toast.error(`Failed to disable notifications for route ${routeId}`);
                                        }
                                    }}
                                >
                                    Disable Alerts
                                </Button>
                            ) : (
                                <Button onClick={handleEnableOrUpdate} disabled={saving}>
                                    Enable Alerts
                                </Button>
                            )}
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
