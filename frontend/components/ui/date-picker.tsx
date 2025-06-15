import * as React from "react"
import { isSameDay } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"

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
                    aria-label="Service calendar picker"
                >
                    <CalendarIcon className="h-4 w-4" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2">
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
                    captionLayout="dropdown"
                />
            </PopoverContent>
        </Popover>
    )
}