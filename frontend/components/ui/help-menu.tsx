import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { HelpCircle } from "lucide-react"
import { ReactNode } from "react"

export default function HelpMenu({ title, children }: { title: string, children: ReactNode }) {
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="outline" size="icon">
                    <HelpCircle />
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}:</DialogTitle>
                    <div className="text-sm text-muted-foreground">
                        {children}
                    </div>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    )
}