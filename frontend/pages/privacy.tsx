import { Header } from "@/components/nav"
import Link from "next/link"
import type { ReactNode } from "react"

/** Where privacy questions and deletion requests go. */
const CONTACT_EMAIL = "james@suddsy.dev"
const LAST_UPDATED = "29 September 2026"

/**
 * The privacy policy for the Transit iPhone app (and this website) - the
 * App Store's privacy policy URL points here. Keep it in step with what the
 * app actually sends: backend/providers/notifications (device, reminder and
 * Live Activity tables), plan_store.go (6h plan cache) and logging.go
 * (request logs, 7 days).
 */
export default function Privacy() {
    return (
        <>
            <Header title="Privacy Policy" />
            <div className="mx-auto w-full max-w-[1400px] px-4 pb-12">
                <article className="max-w-2xl">
                    <div className="mb-8">
                        <h1 className="text-xl font-semibold tracking-tight">Privacy Policy</h1>
                        <p className="text-sm text-muted-foreground mt-1">Transit for iPhone and this website · Last updated {LAST_UPDATED}</p>
                    </div>

                    <Section title="The short version">
                        <ul>
                            <li>There are no accounts, no ads, no analytics and no tracking.</li>
                            <li>Your saved stops, places and trips stay on your device, or in the app&apos;s iCloud storage if you turn on sync.</li>
                            <li>Your location is used to answer the request you make (nearby stops, a journey plan, walking directions) and isn&apos;t kept as a history of where you&apos;ve been.</li>
                            <li>If you turn on notifications, reminders or a Live Activity, the server keeps what it needs to send them, and removes it when you turn them off or the journey is over.</li>
                            <li>We never sell or share your data.</li>
                        </ul>
                    </Section>

                    <Section title="Stored on your device">
                        <p>
                            Saved stops, saved places (such as Home or Work), saved trips, your region and your settings are stored on your
                            iPhone. The app also keeps a copy of a journey you&apos;re tracking so it can keep following it without mobile data.
                            None of this is sent to us.
                        </p>
                        <p>
                            If you turn on <strong>iCloud sync</strong>, this data is also stored in the app&apos;s iCloud container through Apple&apos;s
                            CloudKit, so it appears on your other devices. We can see what is stored there, and only use it to run and support
                            the app. You can turn sync off in the app&apos;s settings.
                        </p>
                    </Section>

                    <Section title="Location">
                        <p>With your permission, the app uses your location to:</p>
                        <ul>
                            <li>show stops near you and your position on the map</li>
                            <li>plan journeys and time walking directions from where you are</li>
                            <li>find the bus, train or ferry you&apos;re on</li>
                            <li>follow a journey you&apos;re tracking, including in the background, and tell you when your stop is next</li>
                        </ul>
                        <p>
                            Background location is only used while you&apos;re tracking a journey, and iOS shows its location indicator while it
                            is. Tracking on the ride itself happens on your phone: the server is told which part of the journey you&apos;re on
                            (for example &quot;on board the second bus&quot;), not your GPS position.
                        </p>
                        <p>
                            When you plan a journey, look for nearby stops, get walking directions or search for an address, the coordinates
                            needed for that request are sent to our server. They&apos;re used to answer the request and aren&apos;t linked to you.
                            Journey plans are cached for up to 6 hours after the journey ends so that shared links work.
                        </p>
                    </Section>

                    <Section title="Notifications, reminders and Live Activities">
                        <p>These features only work if you turn them on. When you do, our server stores:</p>
                        <ul>
                            <li>
                                a random device identifier created by the app, and the push tokens Apple gives it, so we can send
                                notifications to your device (they don&apos;t identify you personally)
                            </li>
                            <li>the stops and routes you&apos;ve asked for service alerts on, and your alert preferences</li>
                            <li>
                                leave-by reminders you set: the start and end points of that journey, the time you want to travel and
                                how often it repeats
                            </li>
                            <li>
                                for a Live Activity, the journey being tracked, its Live Activity push token and which part of the
                                journey you&apos;re on, so the Lock Screen keeps updating while the app is closed
                            </li>
                            <li>a short history of the notifications sent to your device, shown in the app</li>
                        </ul>
                        <p>
                            Removing an alert or reminder in the app deletes it from the server. A Live Activity&apos;s record is deleted when
                            the journey ends. Notifications are delivered through Apple Push Notification service.
                        </p>
                    </Section>

                    <Section title="Server logs">
                        <p>
                            Like most web services, our server logs each request it receives: the time, the address requested, the result
                            and your IP address. These logs are used to keep the service running, fix problems and prevent abuse, and are
                            deleted after 7 days.
                        </p>
                    </Section>

                    <Section title="Other services we use">
                        <ul>
                            <li>
                                <strong>Transport data</strong> comes from Auckland Transport, Metlink and Environment Canterbury&apos;s open data.
                                Our server fetches it; your device and location are never sent to them.
                            </li>
                            <li>
                                <strong>Walking directions</strong> are calculated with OSRM, an open-source routing service. Our server sends it the
                                start and end coordinates of the walk only.
                            </li>
                            <li>
                                <strong>Address search</strong> uses Nominatim (OpenStreetMap), run by us.
                            </li>
                            <li>
                                <strong>Apple</strong> provides maps, push notifications and iCloud sync, under{" "}
                                <a href="https://www.apple.com/legal/privacy/" target="_blank" rel="noreferrer">Apple&apos;s privacy policy</a>.
                            </li>
                        </ul>
                        <p>The app contains no advertising, analytics or crash-reporting SDKs.</p>
                    </Section>

                    <Section title="This website">
                        <p>
                            The website works the same way: your saved stops and settings are kept in your browser&apos;s storage, and if you
                            turn on notifications the server stores your browser&apos;s push subscription (which expires after 30 days) and the
                            alerts and reminders you set.
                        </p>
                    </Section>

                    <Section title="Your choices">
                        <ul>
                            <li>You can turn off location, notifications and Live Activities at any time in iOS Settings.</li>
                            <li>Removing an alert or reminder in the app deletes it from our server.</li>
                            <li>Deleting the app removes everything stored on your device. Data in your iCloud can be removed in iOS Settings → [your name] → iCloud.</li>
                            <li>
                                To have everything linked to your device removed from our server, or to ask what we hold, contact us (below)
                                and we&apos;ll do it.
                            </li>
                        </ul>
                        <p>
                            We handle personal information in line with the New Zealand Privacy Act 2020. You have the right to ask for
                            access to, and correction of, your personal information.
                        </p>
                    </Section>

                    <Section title="Children">
                        <p>Transit is suitable for everyone and doesn&apos;t knowingly collect personal information from children.</p>
                    </Section>

                    <Section title="Changes">
                        <p>If this policy changes, we&apos;ll update this page and the date at the top.</p>
                    </Section>

                    <Section title="Contact">
                        <p>
                            Questions or requests about your privacy:{" "}
                            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
                        </p>
                    </Section>

                    <p className="mt-10 text-xs text-muted-foreground">
                        <Link href="/settings">Back to settings</Link>
                    </p>
                </article>
            </div>
        </>
    )
}

function Section({ title, children }: { title: string, children: ReactNode }) {
    return (
        <section className="mb-8">
            <h2 className="text-base font-semibold tracking-tight mb-2">{title}</h2>
            <div className="space-y-3 text-sm leading-relaxed text-foreground/90 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_a]:underline [&_a]:underline-offset-2">
                {children}
            </div>
        </section>
    )
}
