import { useState } from 'react'
import ContentLayout from '@cloudscape-design/components/content-layout'
import Header from '@cloudscape-design/components/header'
import Tabs from '@cloudscape-design/components/tabs'
import Wizard from '@cloudscape-design/components/wizard'
import Button from '@cloudscape-design/components/button'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Flashbar, { FlashbarProps } from '@cloudscape-design/components/flashbar'
import { useMigrationStore } from '../store/migrationStore'
import { SourceDatabaseForm } from '../components/SourceDatabaseForm'
import { AWSTargetForm } from '../components/AWSTargetForm'
import { MigrationOptionsForm } from '../components/MigrationOptionsForm'
import { ReviewAndExecute } from '../components/ReviewAndExecute'
import { BatchMigrationForm } from '../components/BatchMigrationForm'
import { MigrationHistory } from '../components/MigrationHistory'

export default function DatabaseMigrationDashboardPage() {
  const {
    currentStep,
    setCurrentStep,
    migrationMode,
    setMigrationMode,
    source,
    target,
    options,
    sourceInstanceId,
    targetInstanceId,
    sourcePassword,
    targetPassword,
    sourceWindowsPassword,
    targetWindowsPassword,
    loadConfig,
    configVersion,
  } = useMigrationStore()

  const [flashItems, setFlashItems] = useState<FlashbarProps.MessageDefinition[]>([])

  const showToast = (
    message: string,
    type: 'success' | 'error' | 'warning' | 'info'
  ) => {
    const id = Date.now().toString()
    setFlashItems((prev) => [
      ...prev,
      {
        id,
        type,
        content: message,
        dismissible: true,
        onDismiss: () => setFlashItems((p) => p.filter((item) => item.id !== id)),
      },
    ])
    setTimeout(() => {
      setFlashItems((prev) => prev.filter((item) => item.id !== id))
    }, 5000)
  }

  const saveConfig = () => {
    const hasData = Object.keys(source).length > 0 || Object.keys(target).length > 0
    if (!hasData) {
      showToast('Please fill out and submit at least one form step before saving', 'warning')
      return
    }
    const config = {
      source,
      target,
      options,
      sourceInstanceId,
      targetInstanceId,
      sourcePassword,
      targetPassword,
      sourceWindowsPassword,
      targetWindowsPassword,
    }
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'migration-config.json'
    a.click()
    URL.revokeObjectURL(url)
    showToast('Configuration saved successfully', 'success')
  }

  const handleLoadConfig = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (event) => {
        try {
          const config = JSON.parse(event.target?.result as string)
          loadConfig(config)
          showToast('Configuration loaded successfully', 'success')
        } catch {
          showToast('Error loading configuration file', 'error')
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  // Wizard step index is 0-based, store step is 1-based
  const activeWizardStep = currentStep - 1

  const handleWizardNavigate = (event: {
    detail: { requestedStepIndex: number; reason: string }
  }) => {
    const { requestedStepIndex } = event.detail
    setCurrentStep(requestedStepIndex + 1)
  }

  const handleWizardSubmit = () => {
    // Final submit handled by ReviewAndExecute
  }

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button iconName="upload" onClick={handleLoadConfig}>
                Load Config
              </Button>
              <Button iconName="download" onClick={saveConfig}>
                Save Config
              </Button>
            </SpaceBetween>
          }
        >
          Database Migration Orchestrator
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Flashbar items={flashItems} />

        <Tabs
          activeTabId={migrationMode}
          onChange={({ detail }) =>
            setMigrationMode(detail.activeTabId as 'single' | 'batch' | 'history')
          }
          tabs={[
            {
              id: 'single',
              label: 'Single Database',
              content: (
                <Wizard
                  i18nStrings={{
                    stepNumberLabel: (stepNumber) => `Step ${stepNumber}`,
                    collapsedStepsLabel: (stepNumber, stepsCount) =>
                      `Step ${stepNumber} of ${stepsCount}`,
                    cancelButton: 'Cancel',
                    previousButton: 'Previous',
                    nextButton: 'Next',
                    submitButton: 'Start Migration',
                    optional: 'optional',
                  }}
                  activeStepIndex={activeWizardStep}
                  onNavigate={({ detail }) => handleWizardNavigate({ detail })}
                  onSubmit={handleWizardSubmit}
                  isLoadingNextStep={false}
                  allowSkipTo={false}
                  steps={[
                    {
                      title: 'Source Database',
                      description: 'Configure the source database connection',
                      content: (
                        <SourceDatabaseForm
                          key={`source-${configVersion}`}
                          onNext={() => setCurrentStep(2)}
                          onTest={showToast}
                        />
                      ),
                    },
                    {
                      title: 'AWS Target',
                      description: 'Configure the AWS target database',
                      content: (
                        <AWSTargetForm
                          key={`target-${configVersion}`}
                          onNext={() => setCurrentStep(3)}
                          onPrev={() => setCurrentStep(1)}
                          onTest={showToast}
                        />
                      ),
                    },
                    {
                      title: 'Migration Options',
                      description: 'Configure migration type and options',
                      content: (
                        <MigrationOptionsForm
                          key={`options-${configVersion}`}
                          onNext={() => setCurrentStep(4)}
                          onPrev={() => setCurrentStep(2)}
                        />
                      ),
                    },
                    {
                      title: 'Review & Execute',
                      description: 'Review configuration and start migration',
                      content: <ReviewAndExecute onPrev={() => setCurrentStep(3)} />,
                    },
                  ]}
                />
              ),
            },
            {
              id: 'batch',
              label: 'Bulk Migration (Up to 4 DBs)',
              content: <BatchMigrationForm />,
            },
            {
              id: 'history',
              label: 'Migration History',
              content: <MigrationHistory />,
            },
          ]}
        />
      </SpaceBetween>
    </ContentLayout>
  )
}
