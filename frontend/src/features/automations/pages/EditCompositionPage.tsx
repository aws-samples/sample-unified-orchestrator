import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ContentLayout,
  Header,
  Box,
  Spinner,
  Alert,
} from '@cloudscape-design/components'
import { iacAgentApi, BlueprintSelection } from '../services/iacAgent'
import { ROUTES } from '../constants'
import ComposerWizard from './iac-agent/ComposerWizard'
import { useIacDocsPanel } from '../hooks/useIacDocsPanel'

function parseComposition(raw: unknown): BlueprintSelection[] {
  if (!raw) return []
  const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
  return (obj as { blueprints?: BlueprintSelection[] }).blueprints ?? []
}

export default function EditCompositionPage() {
  useIacDocsPanel()
  const { motsId } = useParams<{ motsId: string }>()
  const navigate = useNavigate()
  const [initialComposition, setInitialComposition] = useState<BlueprintSelection[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!motsId) return
    const load = async () => {
      try {
        const { data } = await iacAgentApi.getAppCatalog(motsId)
        const record = data as Record<string, unknown>
        setInitialComposition(parseComposition(record.app_composition))
      } catch {
        setError('Failed to load composition')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [motsId])

  if (!motsId) {
    return (<ContentLayout header={<Header variant="h1">Edit Composition</Header>}><Alert type="error">Missing MOTS ID</Alert></ContentLayout>)
  }
  if (loading) {
    return (<ContentLayout header={<Header variant="h1">Edit Composition — {motsId}</Header>}><Box textAlign="center" padding="xl"><Spinner size="large" /></Box></ContentLayout>)
  }
  if (error) {
    return (<ContentLayout header={<Header variant="h1">Edit Composition — {motsId}</Header>}><Alert type="error">{error}</Alert></ContentLayout>)
  }

  return (
    <ContentLayout header={<Header variant="h1">Edit Composition — {motsId}</Header>}>
      <ComposerWizard
        motsId={motsId}
        initialComposition={initialComposition ?? undefined}
        onComplete={() => navigate(ROUTES.COMPOSITIONS)}
        onCancel={() => navigate(ROUTES.COMPOSITIONS)}
      />
    </ContentLayout>
  )
}
