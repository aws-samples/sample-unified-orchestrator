import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../ui/tooltip'
import { HelpCircle } from 'lucide-react'
import { cn } from '../../lib/utils'

interface TitleWithTooltipProps {
  as?: 'h1' | 'h2' | 'h3'
  className?: string
  children: React.ReactNode
  tooltip: string
}

export default function TitleWithTooltip({
  as: Tag = 'h2',
  className,
  children,
  tooltip,
}: TitleWithTooltipProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Tag className="text-inherit font-inherit">{children}</Tag>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="text-slate-500 hover:text-indigo-600 transition-colors focus:outline-none focus:ring-0"
            aria-label="What does this mean?"
          >
            <HelpCircle className="h-4 w-4 shrink-0" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs">
          <p className="text-sm">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
