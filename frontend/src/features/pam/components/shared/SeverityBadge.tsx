import { cn } from '../../lib/utils'

const bucketStyles: Record<string, string> = {
  LOW: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  MEDIUM: 'bg-amber-100 text-amber-700 border-amber-200',
  HIGH: 'bg-rose-100 text-rose-700 border-rose-200',
}

interface SeverityBadgeProps {
  bucket: string
  className?: string
}

export default function SeverityBadge({ bucket, className }: SeverityBadgeProps) {
  const style = bucketStyles[bucket?.toUpperCase()] ?? 'bg-slate-100 text-slate-600 border-slate-200'
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border',
        style,
        className,
      )}
    >
      {bucket}
    </span>
  )
}
