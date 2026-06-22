import { Header } from "@/components/nav";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUrl } from "@/lib/url-context";
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes";

export default function Settings() {
    const { urlOptions, setCurrentUrl, currentUrl } = useUrl()
    const { setTheme, theme } = useTheme()

    return (
        <>
            <Header title="Settings" />
            <div className="mx-auto w-full max-w-[1400px] px-4 pb-8">
                <div className="mb-6">
                    <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
                    <p className="text-sm text-muted-foreground mt-1">Manage your preferences</p>
                </div>

                <div className="max-w-lg divide-y divide-border border rounded-xl overflow-hidden bg-card">
                    {/* Region */}
                    <div className="flex items-center justify-between gap-6 px-4 py-3.5">
                        <div>
                            <p className="text-sm font-medium">Region</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Your transit provider</p>
                        </div>
                        <Select
                            value={currentUrl.url}
                            onValueChange={(val) => {
                                const item = urlOptions.find((item) => item.url === val)
                                if (item) {
                                    setCurrentUrl(item)
                                    window.location.reload()
                                }
                            }}
                        >
                            <SelectTrigger className="w-[200px] shrink-0">
                                <SelectValue placeholder="Select a provider" />
                            </SelectTrigger>
                            <SelectContent>
                                {urlOptions.map((item) => (
                                    <SelectItem key={item.url} value={item.url}>
                                        <div className="flex items-center gap-2">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                alt="provider logo"
                                                className="w-4 h-4 object-contain"
                                                src={item.logoUrl}
                                            />
                                            <span>{item.displayName}</span>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Theme */}
                    <div className="flex items-center justify-between gap-6 px-4 py-3.5">
                        <div>
                            <p className="text-sm font-medium">Appearance</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Light, dark, or match system</p>
                        </div>
                        <Select value={theme || "system"} onValueChange={(val) => setTheme(val)}>
                            <SelectTrigger className="w-[140px] shrink-0">
                                <SelectValue placeholder="Select theme" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="light">
                                    <div className="flex items-center gap-2">
                                        <Sun className="w-4 h-4" /> Light
                                    </div>
                                </SelectItem>
                                <SelectItem value="dark">
                                    <div className="flex items-center gap-2">
                                        <Moon className="w-4 h-4" /> Dark
                                    </div>
                                </SelectItem>
                                <SelectItem value="system">
                                    <div className="flex items-center gap-2">
                                        <Monitor className="w-4 h-4" /> System
                                    </div>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>
        </>
    );
}
