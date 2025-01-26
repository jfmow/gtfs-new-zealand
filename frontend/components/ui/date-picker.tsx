import * as React from "react"
import { format, isSameDay } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

interface DatePicker {
    onChange: (date: Date) => void,
    defaultValue?: Date | undefined
}

export function DatePicker({ onChange, defaultValue }: { onChange: (date: Date | undefined) => void, defaultValue?: Date }) {
    const [date, setDate] = React.useState<Date | undefined>(defaultValue)

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant={"outline"}
                    className={cn(
                        "w-[280px] justify-start text-left font-normal",
                        !date && "text-muted-foreground"
                    )}
                >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, "PPP") : <span>Pick a date</span>}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
                <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(newDate) => {
                        const today = new Date()
                        if (newDate && isSameDay(newDate, today)) {
                            setDate(undefined)
                            onChange(undefined)
                        } else {
                            setDate(newDate)
                            onChange(newDate)
                        }
                    }}
                    initialFocus
                />
            </PopoverContent>
        </Popover>
    )
}