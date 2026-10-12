import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider, useTheme } from '../../src/features/uno/contexts/ThemeContext'
import { Mode } from '@cloudscape-design/global-styles'

// Test component that uses the theme context
function TestComponent() {
  const { mode, toggleMode } = useTheme()

  return (
    <div>
      <div data-testid="current-mode">{mode}</div>
      <button onClick={toggleMode} data-testid="toggle-button">
        Toggle Mode
      </button>
    </div>
  )
}

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('should provide default light mode', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    expect(screen.getByTestId('current-mode').textContent).toBe(Mode.Light)
  })

  it('should toggle between light and dark modes', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    const toggleButton = screen.getByTestId('toggle-button')
    const modeDisplay = screen.getByTestId('current-mode')

    expect(modeDisplay.textContent).toBe(Mode.Light)

    fireEvent.click(toggleButton)
    expect(modeDisplay.textContent).toBe(Mode.Dark)

    fireEvent.click(toggleButton)
    expect(modeDisplay.textContent).toBe(Mode.Light)
  })

  it('should persist mode to localStorage', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    )

    const toggleButton = screen.getByTestId('toggle-button')
    fireEvent.click(toggleButton)

    expect(localStorage.getItem('cloudscape-mode')).toBe(Mode.Dark)
  })
})
