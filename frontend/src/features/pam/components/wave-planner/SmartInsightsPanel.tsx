import { useState, useEffect } from 'react'
import { Box, Button, Spinner, SpaceBetween } from '@cloudscape-design/components'
import { dualApiClient } from '../../api/dualApiClient'

interface SmartInsight {
  type: 'big-rocks' | 'quick-wins' | 'move-group' | 'dependency'
  title: string
  description: string
  applications: Array<{
    motsId: number
    appName: string
    score: number
    reason: string
  }>
  priority: number
}

interface Props {
  onApplyInsight: (motsIds: number[]) => void
}

export default function SmartInsightsPanel({ onApplyInsight }: Props) {
  const [insights, setInsights] = useState<SmartInsight[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedInsight, setSelectedInsight] = useState<SmartInsight | null>(null)

  useEffect(() => {
    loadInsights()
  }, [])

  const loadInsights = async () => {
    try {
      setLoading(true)

      const [leaderboard, moveGroups] = await Promise.all([
        dualApiClient<any>('/api/applications/complexity/leaderboard', {
          backend: 'migration-refinery',
          params: { sort: 'big-rocks', page: 0, size: 10, includeDependencies: true }
        }),
        dualApiClient<any>('/api/move-groups/cluster', {
          backend: 'migration-refinery',
          method: 'POST',
          body: { k: 3, minScore: 0 }
        }).catch(() => null)
      ])

      const generatedInsights: SmartInsight[] = []

      if (leaderboard?.content?.length > 0) {
        const bigRocks = leaderboard.content
          .filter((app: any) => app.totalScore >= 60 && !app.waveId)
          .slice(0, 5)

        if (bigRocks.length > 0) {
          generatedInsights.push({
            type: 'big-rocks',
            title: 'Big Rocks First',
            description: 'High complexity applications that should be tackled early',
            applications: bigRocks.map((app: any) => ({
              motsId: app.motsId,
              appName: app.appName,
              score: app.totalScore,
              reason: `High complexity (${app.complexityBucket})`
            })),
            priority: 1
          })
        }
      }

      const quickWins = await dualApiClient<any>('/api/applications/complexity/leaderboard', {
        backend: 'migration-refinery',
        params: { sort: 'quick-wins', page: 0, size: 10 }
      })

      if (quickWins?.content?.length > 0) {
        const wins = quickWins.content
          .filter((app: any) => app.totalScore < 40 && !app.waveId)
          .slice(0, 5)

        if (wins.length > 0) {
          generatedInsights.push({
            type: 'quick-wins',
            title: 'Quick Wins',
            description: 'Low complexity applications for early momentum',
            applications: wins.map((app: any) => ({
              motsId: app.motsId,
              appName: app.appName,
              score: app.totalScore,
              reason: `Low complexity (${app.complexityBucket})`
            })),
            priority: 2
          })
        }
      }

      if (moveGroups?.clusters?.length > 0) {
        const largestCluster = moveGroups.clusters
          .sort((a: any, b: any) => b.size - a.size)[0]

        if (largestCluster && largestCluster.members.length >= 3) {
          generatedInsights.push({
            type: 'move-group',
            title: 'Similar Applications Group',
            description: 'Applications with similar complexity profiles',
            applications: largestCluster.members.slice(0, 5).map((member: any) => ({
              motsId: member.motsId,
              appName: member.appName,
              score: largestCluster.averageTotalScore,
              reason: 'Similar complexity pattern'
            })),
            priority: 3
          })
        }
      }

      setInsights(generatedInsights)
    } catch (error) {
      console.error('Failed to load insights:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <Spinner />
  }

  return (
    <Box padding="m">
      <SpaceBetween size="m">
        <Box variant="h3">Smart Insights</Box>
        {insights.length === 0 ? (
          <Box variant="p">No insights available</Box>
        ) : (
          insights.map((insight, idx) => (
            <div
              key={idx}
              style={{ cursor: 'pointer', backgroundColor: '#f5f5f5', padding: '12px', border: '1px solid #e0e0e0', borderRadius: '8px' }}
              onClick={() => setSelectedInsight(selectedInsight === insight ? null : insight)}
            >
              <SpaceBetween size="s">
                <Box variant="h4">{insight.title}</Box>
                <Box variant="p">{insight.description}</Box>
                <Box variant="p">{insight.applications.length} apps</Box>
                <Button onClick={(e) => {
                  e.stopPropagation()
                  onApplyInsight(insight.applications.map(a => a.motsId))
                }}>
                  Apply to Wave
                </Button>
                {selectedInsight === insight && (
                  <Box>
                    {insight.applications.map(app => (
                      <Box key={app.motsId} variant="p">
                        <strong>{app.appName}</strong> (MOTS: {app.motsId}) - Score: {Math.round(app.score)}
                      </Box>
                    ))}
                  </Box>
                )}
              </SpaceBetween>
            </div>
          ))
        )}
        <Button onClick={loadInsights}>Refresh Insights</Button>
      </SpaceBetween>
    </Box>
  )
}
