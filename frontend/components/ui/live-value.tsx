import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { cn } from "@/lib/utils"

interface LiveValueProps {
    value: string
    className?: string
}

/** Split-flap style flip when the displayed value changes - for live-polled numbers (distance, ETA). */
export function LiveValue({ value, className }: LiveValueProps) {
    const reduceMotion = useReducedMotion()

    return (
        <span className={cn("inline-grid overflow-hidden align-middle", className)}>
            <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                    key={value}
                    initial={reduceMotion ? false : { rotateX: -90, opacity: 0 }}
                    animate={{ rotateX: 0, opacity: 1 }}
                    exit={reduceMotion ? undefined : { rotateX: 90, opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                    className="[grid-area:1/1] font-mono tabular-nums"
                    style={{ transformOrigin: "50% 50%", backfaceVisibility: "hidden" }}
                >
                    {value}
                </motion.span>
            </AnimatePresence>
        </span>
    )
}
