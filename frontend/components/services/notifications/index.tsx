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
                        <DialogTitle>{alreadySubbed ? ("Disable") : ("Enable")} alerts for {stopName}</DialogTitle>
                        <DialogDescription>
                            {alreadySubbed ? ("Stop receiving") : ("Receive")} push notifications for any cancellations or alerts for {stopName}.
                            (lasts 30 days)
                        </DialogDescription>
                    </DialogHeader>
                    {checking ? (
                        <LoadingSpinner height="200px" description="Checking..." />
                    ) : (
                        <>
                            <div className="flex items-center justify-between gap-2">
                                <Button variant={"outline"} onClick={async (e) => {
                                    e.currentTarget.disabled = true
                                    const removed = await removeSubscription("")
                                    if (removed) {
                                        toast.success(`All notifications disabled`)
                                    } else {
                                        toast.error(`Failed to disable notifications`)
                                    }
                                }}>
                                    Disable all
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
                                                toast.success(`Notifications disabled for ${stopName}`)
                                            } else {
                                                toast.error(`Failed to disable notifications for ${stopName}`)
                                            }
                                            setAlreadySubbed(false)
                                        }}>
                                            Disable Notifications
                                        </Button>
                                    ) : (
                                        <Button onClick={async (e) => {
                                            e.preventDefault()
                                            const subbed = await subscribeToStop(stopName)
                                            if (subbed) {
                                                toast.success("Notification added")
                                            } else {
                                                toast.error("Failed to add notification")
                                            }
                                            setAlreadySubbed(true)
                                        }}>
                                            Enable Notifications
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