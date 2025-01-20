import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Drawer,
    DrawerContent,
    DrawerFooter,
    DrawerHeader,
    DrawerTitle,
    DrawerTrigger,
} from "@/components/ui/drawer"
import { useState } from "react"
import { formatTextToNiceLookingWords } from "@/lib/formating"
import { Button } from "@/components/ui/button"



interface TrainStationProps {
    onChange: (v: string) => void
}



const west = [
    "Britomart", "Parnell", "Newmarket", "Grafton", "Kingsland", "Morningside", "Baldwin Ave",
    "Mt Albert", "Avondale", "New Lynn", "Fruitvale Rd", "Glen Eden", "Sunnyvale",
    "Henderson", "Sturges Rd", "Ranui", "Swanson"
]

const south = [
    "Britomart", "Parnell", "Newmarket", "Remuera", "Greenlane", "Ellerslie",
    "Penrose", "Otahuhu", "Middlemore", "Papatoetoe", "Puhinui", "Homai",
    "Manurewa", "Te Mahia", "Takaanini", "Papakura"
]

const east = [
    "Britomart", "Orakei", "Meadowbank", "Glen Innes", "Panmure", "Sylvia Park",
    "Otahuhu", "Middlemore", "Papatoetoe", "Puhinui", "Manukau"
]

const one = [
    "Newmarket", "Remuera", "Greenlane", "Ellerslie", "Penrose", "Te Papapa", "Onehunga"
]

export default function TrainStation({ onChange }: TrainStationProps) {
    const [selectedLine, setSelectedLine] = useState<"western" | "southern" | "eastern" | "onehunga">("western")
    const [selectedStop, setSelectedStop] = useState("")
    return (
        <>
            <Drawer>
                <DrawerTrigger asChild>
                    <Button variant="outline">
                        {selectedStop !== "" ? (
                            formatTextToNiceLookingWords(selectedStop + " | " + selectedLine)
                        ) : (
                            "Select a train station"
                        )}
                    </Button>
                </DrawerTrigger>
                <DrawerContent>
                    <DrawerHeader>
                        <DrawerTitle>Select Train Station</DrawerTitle>
                    </DrawerHeader>
                    <div className="p-4 grid gap-2 sm:grid-cols-2">
                        <Select defaultValue={selectedStop} onValueChange={(v) => {
                            setSelectedStop(v)
                            onChange(v)
                        }}>
                            <SelectTrigger className="">
                                <SelectValue placeholder="Station" />
                            </SelectTrigger>
                            <SelectContent>
                                {lines[selectedLine].map((item) => (
                                    <SelectItem key={item} value={item + " Train Station"}>{item}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select defaultValue={selectedLine} onValueChange={(v) => setSelectedLine(v as "western" | "southern" | "eastern" | "onehunga")}>
                            <SelectTrigger className="">
                                <SelectValue placeholder="Line" />
                            </SelectTrigger>
                            <SelectContent>
                                {Object.keys(lines).map((item) => (
                                    <SelectItem key={item} value={item}>{formatTextToNiceLookingWords(item)} Line</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <DrawerFooter>
                    </DrawerFooter>
                </DrawerContent>
            </Drawer>



        </>
    )
}


const lines = { "western": west, "southern": south, "eastern": east, "onehunga": one }



