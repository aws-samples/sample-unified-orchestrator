import { cn } from '../../lib/utils'

interface PercentageBarProps {
  value: number
  className?: string
  color?: string
}

export default function PercentageBar({ value, className, color }: PercentageBarProps) {
  const clamped = Math.max(0, Math.min(100, value))

  const barColor =
    color ??
    (clamped >= 80
      ? 'bg-emerald-500'
      : clamped >= 50
        ? 'bg-amber-500'
        : 'bg-rose-500')

  return (
    <div className={cn('w-full bg-slate-200 rounded-full h-2', className)}>
      <div
        className={cn('h-2 rounded-full transition-all duration-500', barColor)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
