import { AlertCircle } from 'lucide-react'

interface InlineErrorProps {
  message: string
}

export default function InlineError({ message }: InlineErrorProps) {
  return (
    <div className="flex items-center gap-2 text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-4 py-3 text-sm">
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}
