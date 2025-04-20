import { formatTextToNiceLookingWords } from "@/lib/formating";
import { ServerCrashIcon } from "lucide-react";

export default function ErrorScreen({ errorText, errorTitle }: { errorText: string, errorTitle: string }) {
    return (
        <div className="p-4 mx-auto h-[calc(100vh-4rem)] flex items-center justify-center flex-col gap-1">
            <ServerCrashIcon className="w-8 h-8 text-red-500" />
            <h3 className="scroll-m-20 text-2xl font-semibold tracking-tight">
                {errorTitle}
            </h3>
            <p className="text-sm text-muted-foreground">Error: {formatTextToNiceLookingWords(errorText, true)}</p>
        </div>
    )
}