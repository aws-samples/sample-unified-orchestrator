import React from 'react';
import Badge from '@cloudscape-design/components/badge';

export type StatusField = 'onboarding' | 'risk_assessment' | 'wave_analysis' | 'atx_mapping';

export interface StatusBadgeProps {
  field: StatusField;
  status: string;
}

/**
 * StatusBadge component displays lifecycle status with color coding.
 *
 * Color scheme:
 * - Onboarding: COMPLETED = green, PENDING = grey
 * - Risk Assessment: COMPLETED = green, IN_PROGRESS = blue, NOT_STARTED = grey
 * - Wave Analysis: COMPLETED = green, IN_PROGRESS = blue, NOT_STARTED = grey
 * - ATX Mapping: COMPLETED = green, MAPPED = purple (color="blue"), NOT_MAPPED = grey
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({ field, status }) => {
  const getColor = (): 'green' | 'blue' | 'grey' | 'red' => {
    switch (field) {
      case 'onboarding':
        return status === 'COMPLETED' ? 'green' : 'grey';

      case 'risk_assessment':
      case 'wave_analysis':
        if (status === 'COMPLETED') return 'green';
        if (status === 'IN_PROGRESS') return 'blue';
        return 'grey';

      case 'atx_mapping':
        if (status === 'COMPLETED') return 'green';
        if (status === 'MAPPED') return 'blue'; // Purple-ish in CloudScape
        return 'grey';

      default:
        return 'grey';
    }
  };

  const formatStatus = (status: string): string => {
    // Convert snake_case or SCREAMING_SNAKE_CASE to Title Case
    return status
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  };

  return (
    <Badge color={getColor()}>
      {formatStatus(status)}
    </Badge>
  );
};

export default StatusBadge;
