import { ReactNode, useEffect, useState } from "react";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button";
import { checkStopSubscription, removeSubscription, subscribeToStop } from "@/lib/notifications";
import { toast } from "sonner";
import LoadingSpinner from "@/components/loading-spinner";

//Children is the open trigger
export default function StopNotifications({ stopName, children }: { stopName: string, children: ReactNode }) {
    const [checking, setChecking] = useState(true)
    const [alreadySubbed, setAlreadySubbed] = useState(false)
    useEffect(() => {
        if (stopName === "") return
        setAlreadySubbed(false)
        setChecking(true)
        checkStopSubscription(stopName).then((subbed) => {
            if (subbed.has) {
                setAlreadySubbed(true)
            }
            setChecking(false)
        })
    }, [stopName])
    return (
        <>
            <Dialog>
                <DialogTrigger disabled={stopName === ""} asChild>
                    {children}
                </DialogTrigger>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{alreadySubbed ? ("Disable") : ("Enable")} <span className="text-blue-500">Alerts</span> for {stopName}</DialogTitle>
                        <DialogDescription>
                            {alreadySubbed ? ("Stop receiving") : ("Receive")} push notifications for any delays, cancellations and alerts for {stopName}.
                        </DialogDescription>
                    </DialogHeader>
                    {checking ? (
                        <LoadingSpinner height="200px" description="Checking..." />
                    ) : (
                        <>
                            <div className="flex items-center justify-between gap-2">
                                <Button variant={"outline"} onClick={async (e) => {
                                    if (confirm("This will disable alerts for ALL stops.")) {
                                        e.currentTarget.disabled = true
                                        const removed = await removeSubscription("")
                                        if (removed) {
                                            toast.success(`All notifications disabled`)
                                        } else {
                                            toast.error(`Failed to disable notifications`)
                                        }
                                    }
                                }}>
                                    Disable all alerts
                                </Button>
                                <div className="flex items-center gap-2">
                                    <DialogClose asChild>
                                        <Button variant={"secondary"}>Cancel</Button>
                                    </DialogClose>
                                    {alreadySubbed ? (
                                        <Button variant={"destructive"} onClick={async (e) => {
                                            e.preventDefault()
                                            const removed = await removeSubscription(stopName)
                                            if (removed) {
                                                toast.info(`Notifications disabled for ${stopName}`)
                                            } else {
                                                toast.error(`Failed to disable notifications for ${stopName}`)
                                            }
                                            setAlreadySubbed(false)
                                        }}>
                                            Disable Alerts
                                        </Button>
                                    ) : (
                                        <Button onClick={async (e) => {
                                            e.preventDefault()
                                            const subbed = await subscribeToStop(stopName)
                                            if (subbed) {
                                                toast.success(`Notifications enabled for ${stopName} for 30 days`)
                                                setAlreadySubbed(true)
                                            } else {
                                                toast.error(`Failed to enable notifications for ${stopName}`)
                                            }
                                        }}>
                                            Enable Alerts
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </>
    )
}