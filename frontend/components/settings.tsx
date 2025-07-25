import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUrl } from "@/lib/url-context";
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes";
import { Label } from "@/components/ui/label";

export default function SettingsList() {
    const { urlOptions, setCurrentUrl, currentUrl } = useUrl()
    const { setTheme, theme } = useTheme()
    return (
        <>
            <Label className="mb-2">Region</Label>
            <Select value={currentUrl.url} onValueChange={(val) => {
                const item = urlOptions.find((item) => item.url === val)
                if (item) {
                    setCurrentUrl(item)
                    window.location.reload()
                }
            }}>
                <SelectTrigger className="w-full">
                    <SelectValue placeholder="Provider" />
                </SelectTrigger>
                <SelectContent>
                    {urlOptions.map((item) => (
                        <SelectItem key={item.url} value={item.url}>
                            <div className="flex items-center gap-2">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img alt="provider logo" className="w-4 h-4 object-contain" src={item.logoUrl} />
                                <span style={{ color: item.textColor }}>{item.displayName}</span>
                            </div>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Label className="mb-2 mt-4">App Theme</Label>
            <Select value={theme} defaultValue="system" onValueChange={(val) => setTheme(val)}>
                <SelectTrigger className="w-full">
                    <SelectValue placeholder="Theme" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={"light"}>
                        <div className="flex items-center gap-2">
                            <Sun className="w-4 h-4" />
                            Light
                        </div>
                    </SelectItem>
                    <SelectItem value={"dark"}>
                        <div className="flex items-center gap-2">
                            <Moon className="w-4 h-4" />
                            Dark
                        </div>
                    </SelectItem>
                    <SelectItem value={"system"}>
                        <div className="flex items-center gap-2">
                            <Monitor className="w-4 h-4" />
                            System
                        </div>
                    </SelectItem>
                </SelectContent>
            </Select>
        </>
    )
}