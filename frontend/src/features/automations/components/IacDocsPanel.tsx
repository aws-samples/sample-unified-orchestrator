import { HelpPanel, Icon } from '@cloudscape-design/components'
import { IAC_DOCS_LINKS } from '../constants'

export default function IacDocsPanel() {
  return (
    <HelpPanel header={<h2>Documentation</h2>}>
      <ul>
        {IAC_DOCS_LINKS.map((link) => (
          <li key={link.href}>
            <a href={link.href} target="_blank" rel="noopener noreferrer">
              {link.text} <Icon name="external" />
            </a>
          </li>
        ))}
      </ul>
    </HelpPanel>
  )
}
