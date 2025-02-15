import { UrlSelector } from "@/lib/url-context";

export default function Footer() {
    return (
        <div className="border-t">
            <footer className="mx-auto max-w-[1400px] w-full p-4 flex flex-col sm:flex-row items-center justify-between relative min-h-[70px]">
                <div />
                <UrlSelector />
                <div />
            </footer>
        </div>
    )
}