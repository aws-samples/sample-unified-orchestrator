import React, { useEffect, useState } from 'react';
import {
  Container,
  Header,
  Grid,
  Box,
  SpaceBetween,
  Button,
  Spinner
} from '@cloudscape-design/components';
import { getWaveStatusSummary } from '../../../ara/services/applications';

interface StatusCount {
  [status: string]: number;
}

interface StatusSummaryData {
  wave_id: string;
  total_applications: number;
  onboarding: StatusCount;
  risk_assessment: StatusCount;
  wave_analysis: StatusCount;
  atx_mapping: StatusCount;
}

interface StatusCardProps {
  title: string;
  data: StatusCount;
  totalApps: number;
  onClick?: (status: string) => void;
}

const StatusCard: React.FC<StatusCardProps> = ({ title, data, totalApps, onClick }) => {
  const getPercentage = (count: number): string => {
    if (totalApps === 0) return '0%';
    return `${Math.round((count / totalApps) * 100)}%`;
  };

  const getColorClass = (status: string): string => {
    const lowerStatus = status.toLowerCase();
    if (lowerStatus.includes('completed')) return 'status-completed';
    if (lowerStatus.includes('progress') || lowerStatus.includes('mapped')) return 'status-in-progress';
    return 'status-not-started';
  };

  return (
    <Container
      header={
        <Header variant="h3">
          {title}
        </Header>
      }
    >
      <SpaceBetween size="s">
        {Object.entries(data).map(([status, count]) => (
          <Box key={status}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px',
                borderRadius: '4px',
                cursor: onClick ? 'pointer' : 'default',
                backgroundColor: 'var(--color-background-container-content)'
              }}
              onClick={() => onClick && onClick(status)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  className={getColorClass(status)}
                  style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: status.includes('COMPLETED') ? '#037f0c' :
                                   status.includes('PROGRESS') || status.includes('MAPPED') ? '#0972d3' :
                                   '#5f6b7a'
                  }}
                />
                <span style={{ fontWeight: 500 }}>
                  {status.split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '18px', fontWeight: 600 }}>{count}</span>
                <span style={{ color: 'var(--color-text-status-inactive)', fontSize: '14px' }}>
                  {getPercentage(count)}
                </span>
              </div>
            </div>
          </Box>
        ))}
      </SpaceBetween>
    </Container>
  );
};

interface StatusSummaryProps {
  waveId: string;
  onFilterChange?: (field: string, status: string) => void;
}

export const StatusSummary: React.FC<StatusSummaryProps> = ({ waveId, onFilterChange }) => {
  const [summary, setSummary] = useState<StatusSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getWaveStatusSummary(waveId);
      setSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load status summary');
      console.error('Error fetching status summary:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (waveId) {
      fetchSummary();
    }
  }, [waveId]);

  const handleStatusClick = (field: string, status: string) => {
    if (onFilterChange) {
      onFilterChange(field, status);
    }
  };

  if (loading) {
    return (
      <Container>
        <Box textAlign="center" padding="l">
          <Spinner size="large" />
        </Box>
      </Container>
    );
  }

  if (error) {
    return (
      <Container>
        <Box textAlign="center" padding="l" color="text-status-error">
          {error}
        </Box>
      </Container>
    );
  }

  if (!summary) {
    return (
      <Container>
        <Box textAlign="center" padding="l">
          No status data available
        </Box>
      </Container>
    );
  }

  return (
    <Container
      header={
        <Header
          variant="h2"
          actions={
            <Button iconName="refresh" onClick={fetchSummary}>
              Refresh
            </Button>
          }
        >
          Application Status Summary
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Box>
          <Box variant="awsui-key-label">Total Applications</Box>
          <Box variant="h1">{summary.total_applications}</Box>
        </Box>

        <Grid
          gridDefinition={[
            { colspan: { default: 12, xs: 6, s: 3 } },
            { colspan: { default: 12, xs: 6, s: 3 } },
            { colspan: { default: 12, xs: 6, s: 3 } },
            { colspan: { default: 12, xs: 6, s: 3 } }
          ]}
        >
          <StatusCard
            title="Onboarding"
            data={summary.onboarding}
            totalApps={summary.total_applications}
            onClick={(status) => handleStatusClick('onboarding', status)}
          />
          <StatusCard
            title="Risk Assessment"
            data={summary.risk_assessment}
            totalApps={summary.total_applications}
            onClick={(status) => handleStatusClick('risk_assessment', status)}
          />
          <StatusCard
            title="Wave Analysis"
            data={summary.wave_analysis}
            totalApps={summary.total_applications}
            onClick={(status) => handleStatusClick('wave_analysis', status)}
          />
          <StatusCard
            title="ATX Mapping"
            data={summary.atx_mapping}
            totalApps={summary.total_applications}
            onClick={(status) => handleStatusClick('atx_mapping', status)}
          />
        </Grid>
      </SpaceBetween>
    </Container>
  );
};

export default StatusSummary;
