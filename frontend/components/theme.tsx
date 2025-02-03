import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { Button } from "./ui/button";
import { MoonIcon, SunIcon } from "lucide-react";

type Theme = "light" | "dark"

interface ThemeContext {
    theme: Theme
    setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContext>({
    theme: "light",
    setTheme: () => { }
})

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, _setTheme] = useState<Theme>("light")

    function setTheme(theme: Theme) {
        window.localStorage.setItem("theme", theme)
        _setTheme(theme)
        return theme
    }



    useEffect(() => {
        function getTheme() {
            const storedTheme = window.localStorage.getItem("theme")
            if (!storedTheme || storedTheme === "") {
                return "light"
            }
            return storedTheme as Theme
        }

        setTheme(getTheme())
    }, [])

    useEffect(() => {
        if (theme === "light") {
            document.documentElement.classList.remove("dark");
        } else {
            document.documentElement.classList.add("dark");
        }
    }, [theme])

    return (
        <ThemeContext.Provider value={{ setTheme: setTheme, theme }}>
            {children}
        </ThemeContext.Provider>
    )
}

export default function ThemePicker() {
    const { theme, setTheme } = useContext(ThemeContext)
    return (
        <Button variant={"ghost"} size={"icon"} onClick={() => {
            if (theme === "light") {
                setTheme("dark")
            } else {
                setTheme("light")
            }
        }}>
            {theme === "dark" ? (
                <MoonIcon className="w-4 h-4" />
            ) : null}
            {theme === "light" ? (
                <SunIcon className="w-4 h-4" />
            ) : null}
        </Button>
    )
}


export function useTheme() {
    const context = useContext(ThemeContext)
    return context
}