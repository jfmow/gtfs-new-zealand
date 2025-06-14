import { Loader2 } from "lucide-react"
import React from 'react';

interface LoadingSpinnerProps {
    description?: string
    height?: string
}

export default function LoadingSpinner({ description, height }: LoadingSpinnerProps) {
    return (
        <div style={height && height !== "" ? { height: height } : {}} className="flex items-center justify-center h-[calc(100vh-4rem)] bg-background w-full">
            <div className="flex flex-col items-center space-y-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="text-lg font-medium text-muted-foreground">{description && description !== "" ? description : "Loading..."}</p>
            </div>
        </div>
    )
}


/**
 * A circular progress indicator that visually represents a percentage completion.
 *
 * @param {Object} props - Component properties.
 * @param {number} [props.progress=0] - The progress percentage (0 to 100). Defaults to 0.
 *
 * @returns {JSX.Element} The rendered ProgressCircle component.
 */
export function ProgressCircle({ progress = 0 }) {
    const clampedProgress = Math.min(Math.max(progress, 0), 100)
    const circumference = 2 * Math.PI * 45 // 45 is the radius of the circle
    const strokeDashoffset = circumference - (clampedProgress / 100) * circumference

    return (
        <div className="relative w-32 h-32">
            <svg className="w-full h-full" viewBox="0 0 100 100">
                <circle
                    className="text-gray-200"
                    strokeWidth="10"
                    stroke="currentColor"
                    fill="transparent"
                    r="45"
                    cx="50"
                    cy="50"
                />
                <circle
                    className="text-blue-600"
                    strokeWidth="10"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    stroke="currentColor"
                    fill="transparent"
                    r="45"
                    cx="50"
                    cy="50"
                    style={{
                        transition: 'stroke-dashoffset 0.5s ease-in-out',
                        transform: 'rotate(-90deg)',
                        transformOrigin: '50% 50%',
                    }}
                />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-semibold">{clampedProgress}%</span>
            </div>
        </div>
    )
}

/**
 * A countdown timer displayed as a circular progress indicator.
 *
 * @param {Object} props - Component properties.
 * @param {number} [props.initialTime=60] - The total time in seconds for the timer. Defaults to 60 seconds.
 * @param {number} [props.timeLeft=60] - The remaining time in seconds. Defaults to 60 seconds.
 * @param {boolean} [props.noText=false] - If true, hides the time left text. Defaults to false.
 * @param {string} [props.sizePx="32"] - The size of the timer in pixels. Defaults to "32".
 *
 * @returns {JSX.Element} The rendered ProgressCircleTimer component.
 */
export function ProgressCircleTimer({ initialTime = 60, timeLeft = 60, noText = false, sizePx = "32" }) {
    const progress = (timeLeft / initialTime) * 100;
    const clampedProgress = Math.min(Math.max(progress, 0), 100);
    const circumference = 2 * Math.PI * 45; // 45 is the radius of the circle
    const strokeDashoffset = circumference - (clampedProgress / 100) * circumference;

    return (
        <div className="relative" style={{ width: sizePx + "px", height: sizePx + "px" }}>
            <svg className="w-full h-full" viewBox="0 0 100 100">
                <circle
                    className="text-gray-200"
                    strokeWidth="10"
                    stroke="currentColor"
                    fill="transparent"
                    r="45"
                    cx="50"
                    cy="50"
                />
                <circle
                    className="text-blue-600"
                    strokeWidth="10"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    stroke="currentColor"
                    fill="transparent"
                    r="45"
                    cx="50"
                    cy="50"
                    style={{
                        transition: 'stroke-dashoffset 0.5s ease-in-out',
                        transform: 'rotate(-90deg)',
                        transformOrigin: '50% 50%',
                    }}
                />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
                {!noText ? (
                    <span className="text-sm font-semibold">
                        {Math.max(0, timeLeft)}s
                    </span>
                ) : null}
            </div>
        </div>
    );
}

/**
 * A flat progress bar that visually represents a percentage completion with optional countdown.
 *
 * @param {Object} props - Component properties.
 * @param {number} [props.initialTime=60] - The total time in seconds for the timer. Defaults to 60 seconds.
 * @param {number} [props.timeLeft=60] - The remaining time in seconds. Defaults to 60 seconds.
 * @param {boolean} [props.noText=false] - If true, hides the time left text. Defaults to false.
 * @param {number} [props.height=8] - The height of the progress bar in pixels. Defaults to 8 pixels.
 *
 * @returns {JSX.Element} The rendered FlatProgressTimer component.
 */
export function FlatProgressTimer({
    initialTime = 60,
    timeLeft = 60,
    noText = false,
    height = 8
}) {
    const progress = (timeLeft / initialTime) * 100
    const clampedProgress = Math.min(Math.max(progress, 0), 100)

    return (
        <div className="w-full flex flex-col items-center">
            <div className="w-full bg-gray-200 rounded-full overflow-hidden" style={{ height: `${height}px` }}>
                <div
                    className="bg-primary h-full rounded-full transition-all duration-500 ease-in-out"
                    style={{ width: `${clampedProgress}%` }}
                />
            </div>
            {!noText && (
                <span className="mt-2 text-lg font-semibold">
                    {Math.max(0, timeLeft)}s
                </span>
            )}
        </div>
    )
}