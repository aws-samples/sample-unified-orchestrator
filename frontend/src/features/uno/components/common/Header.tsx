import { Header as CloudScapeHeader } from '@cloudscape-design/components'

interface HeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
}

export default function Header({ title, description, actions }: HeaderProps) {
  return (
    <CloudScapeHeader
      variant="h1"
      description={description}
      actions={actions}
    >
      {title}
    </CloudScapeHeader>
  )
}
