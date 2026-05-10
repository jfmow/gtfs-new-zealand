import { Header } from "@/components/nav";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useUrl } from "@/lib/url-context";
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes";

export default function Settings() {
    const { urlOptions, setCurrentUrl, currentUrl } = useUrl()
    const { setTheme, theme } = useTheme()

    return (
        <>
            <Header title="Settings" />
            <div className="mx-auto w-full max-w-[1400px] flex flex-col px-4 pb-4">
                <div className="mb-8">
                    <h2 className="scroll-m-20 text-3xl font-bold tracking-tight mb-2">Settings</h2>
                    <p className="text-muted-foreground">Customize your app experience</p>
                </div>

                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {/* Region Card */}
                    <Card className="md:col-span-1">
                        <CardHeader>
                            <CardTitle className="text-lg">Region</CardTitle>
                            <CardDescription>Select your transit provider</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-2">
                                <Label htmlFor="region-select" className="text-sm font-medium">Provider</Label>
                                <Select value={currentUrl.url} onValueChange={(val) => {
                                    const item = urlOptions.find((item) => item.url === val)
                                    if (item) {
                                        setCurrentUrl(item)
                                        window.location.reload()
                                    }
                                }}>
                                    <SelectTrigger id="region-select" className="w-full">
                                        <SelectValue placeholder="Select a provider" />
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
                            </div>
                        </CardContent>
                    </Card>

                    {/* Theme Card */}
                    <Card className="md:col-span-1">
                        <CardHeader>
                            <CardTitle className="text-lg">Theme</CardTitle>
                            <CardDescription>Choose your preferred appearance</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-2">
                                <Label htmlFor="theme-select" className="text-sm font-medium">App Theme</Label>
                                <Select value={theme || "system"} onValueChange={(val) => setTheme(val)}>
                                    <SelectTrigger id="theme-select" className="w-full">
                                        <SelectValue placeholder="Select a theme" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="light">
                                            <div className="flex items-center gap-2">
                                                <Sun className="w-4 h-4" />
                                                Light
                                            </div>
                                        </SelectItem>
                                        <SelectItem value="dark">
                                            <div className="flex items-center gap-2">
                                                <Moon className="w-4 h-4" />
                                                Dark
                                            </div>
                                        </SelectItem>
                                        <SelectItem value="system">
                                            <div className="flex items-center gap-2">
                                                <Monitor className="w-4 h-4" />
                                                System
                                            </div>
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </>
    );
}