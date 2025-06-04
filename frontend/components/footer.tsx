import { UrlSelector } from "@/lib/url-context";
import ThemePicker from "./theme";

export default function Footer() {
    return (
        <div className="border-t">
            <footer className="mx-auto max-w-[1400px] w-full p-4 flex items-center justify-between relative min-h-[70px]">
                <UrlSelector />
                <ThemePicker />
            </footer>
        </div>
    )
}