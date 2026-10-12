import { type LucideIcon } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../ui/tooltip'
import Spinner from './Spinner'
import InlineError from './InlineError'

interface StatCardProps {
  label: string
  labelTooltip?: string
  value: string | number | null
  icon?: LucideIcon
  loading?: boolean
  error?: string | null
  children?: React.ReactNode
}

export default function StatCard({
  label,
  labelTooltip,
  value,
  icon: Icon,
  loading,
  error,
  children,
}: StatCardProps) {
  const labelEl = (
    <span className="text-sm font-medium text-slate-500">{label}</span>
  )

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        {labelTooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-left text-sm font-medium text-slate-500 hover:text-slate-700 focus:outline-none cursor-help"
              >
                {label}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p className="text-sm">{labelTooltip}</p>
            </TooltipContent>
          </Tooltip>
        ) : (
          labelEl
        )}
        {Icon && <Icon className="h-5 w-5 text-slate-500 shrink-0" />}
      </div>
      {loading ? (
        <Spinner className="py-2" />
      ) : error ? (
        <InlineError message={error} />
      ) : (
        <>
          <div className="text-3xl font-bold text-slate-900">{value ?? 'N/A'}</div>
          {children}
        </>
      )}
    </div>
  )
}
