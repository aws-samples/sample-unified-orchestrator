import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { applyMode, Mode, applyDensity, Density } from '@cloudscape-design/global-styles'

interface ThemeContextType {
  mode: Mode
  density: Density
  setMode: (mode: Mode) => void
  setDensity: (density: Density) => void
  toggleMode: () => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

interface ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [mode, setModeState] = useState<Mode>(() => {
    const savedMode = localStorage.getItem('cloudscape-mode')
    return (savedMode as Mode) || Mode.Light
  })

  const [density, setDensityState] = useState<Density>(() => {
    const savedDensity = localStorage.getItem('cloudscape-density')
    return (savedDensity as Density) || Density.Comfortable
  })

  useEffect(() => {
    applyMode(mode)
    localStorage.setItem('cloudscape-mode', mode)
  }, [mode])

  useEffect(() => {
    applyDensity(density)
    localStorage.setItem('cloudscape-density', density)
  }, [density])

  const setMode = (newMode: Mode) => {
    setModeState(newMode)
  }

  const setDensity = (newDensity: Density) => {
    setDensityState(newDensity)
  }

  const toggleMode = () => {
    setModeState(mode === Mode.Light ? Mode.Dark : Mode.Light)
  }

  return (
    <ThemeContext.Provider value={{ mode, density, setMode, setDensity, toggleMode }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
