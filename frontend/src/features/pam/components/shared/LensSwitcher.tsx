import { cn } from '../../lib/utils'

interface LensSwitcherProps {
  lenses: { value: string; label: string }[]
  active: string
  onChange: (value: string) => void
}

export default function LensSwitcher({ lenses, active, onChange }: LensSwitcherProps) {
  return (
    <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-lg">
      {lenses.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          className={cn(
            'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
            active === value
              ? 'bg-white text-indigo-700 shadow-sm border border-slate-200'
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
