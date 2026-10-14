import { ContentLayout, Container, Header, Button, SpaceBetween } from '@cloudscape-design/components'
import { useNavigate } from 'react-router-dom'

export default function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <ContentLayout
      header={
        <Header variant="h1">
          Page Not Found
        </Header>
      }
    >
      <Container>
        <SpaceBetween size="m">
          <p>The page you are looking for does not exist.</p>
          <Button variant="primary" onClick={() => navigate('/')}>
            Go to Home
          </Button>
        </SpaceBetween>
      </Container>
    </ContentLayout>
  )
}
