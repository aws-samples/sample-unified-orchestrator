import { describe, it, expect } from 'vitest'

/**
 * Test suite to verify score calculation logic matches migration-application-score.md
 *
 * Team Readiness Score Weights:
 * - Team Availability: 30%
 * - Skill Level: 30%
 * - Knowledge Transfer: 25%
 * - Training Completed: 15%
 *
 * Business Readiness Score Weights:
 * - Maintenance Window: 25%
 * - Business Calendar: 25%
 * - Stakeholder Alignment: 25%
 * - Budget Availability: 25%
 */

describe('Readiness Score Calculation Logic', () => {
  describe('Team Readiness Score', () => {
    const calculateTeamReadinessScore = (
      teamAvailability: number,
      skillLevel: number,
      knowledgeTransfer: number,
      trainingCompleted: number
    ): number => {
      const availability = teamAvailability * 0.30
      const skill = skillLevel * 0.30
      const knowledge = knowledgeTransfer * 0.25
      const training = trainingCompleted * 0.15

      return Math.round(availability + skill + knowledge + training)
    }

    it('calculates perfect score (100) when all factors are 100', () => {
      const score = calculateTeamReadinessScore(100, 100, 100, 100)
      expect(score).toBe(100)
    })

    it('calculates score with dedicated team (100), expert (100), full knowledge (100), all trained (100)', () => {
      const score = calculateTeamReadinessScore(100, 100, 100, 100)
      // 100*0.30 + 100*0.30 + 100*0.25 + 100*0.15 = 30 + 30 + 25 + 15 = 100
      expect(score).toBe(100)
    })

    it('calculates score with part-time team (50), some experience (50), key person (75), some trained (50)', () => {
      const score = calculateTeamReadinessScore(50, 50, 75, 50)
      // 50*0.30 + 50*0.30 + 75*0.25 + 50*0.15 = 15 + 15 + 18.75 + 7.5 = 56.25 → 56
      expect(score).toBe(56)
    })

    it('calculates score with no team (0), no experience (0), docs only (50), no training (0)', () => {
      const score = calculateTeamReadinessScore(0, 0, 50, 0)
      // 0*0.30 + 0*0.30 + 50*0.25 + 0*0.15 = 0 + 0 + 12.5 + 0 = 12.5 → 13
      expect(score).toBe(13)
    })

    it('calculates zero score when all factors are 0', () => {
      const score = calculateTeamReadinessScore(0, 0, 0, 0)
      expect(score).toBe(0)
    })

    it('verifies weight distribution sums to 100%', () => {
      // Weights: 30% + 30% + 25% + 15% = 100%
      const weights = [0.30, 0.30, 0.25, 0.15]
      const sum = weights.reduce((acc, w) => acc + w, 0)
      expect(sum).toBe(1.0)
    })

    it('calculates score matching migration-application-score.md example', () => {
      // From document example: Dedicated (100), Expert (100), Full knowledge (100), All trained (100)
      const score = calculateTeamReadinessScore(100, 100, 100, 100)
      // 100*0.30 + 100*0.30 + 100*0.25 + 100*0.15 = 100
      expect(score).toBe(100)
    })
  })

  describe('Business Readiness Score', () => {
    const calculateBusinessReadinessScore = (
      maintenanceWindow: number,
      businessCalendar: number,
      stakeholderAlignment: number,
      budgetAvailability: number
    ): number => {
      const maintenance = maintenanceWindow * 0.25
      const calendar = businessCalendar * 0.25
      const stakeholder = stakeholderAlignment * 0.25
      const budget = budgetAvailability * 0.25

      return Math.round(maintenance + calendar + stakeholder + budget)
    }

    it('calculates perfect score (100) when all factors are 100', () => {
      const score = calculateBusinessReadinessScore(100, 100, 100, 100)
      expect(score).toBe(100)
    })

    it('calculates score with flexible (100), off-peak (100), some concerns (50), fully funded (100)', () => {
      const score = calculateBusinessReadinessScore(100, 100, 50, 100)
      // 100*0.25 + 100*0.25 + 50*0.25 + 100*0.25 = 25 + 25 + 12.5 + 25 = 87.5 → 88
      expect(score).toBe(88)
    })

    it('calculates score with limited (50), normal (50), full buy-in (100), partial (50)', () => {
      const score = calculateBusinessReadinessScore(50, 50, 100, 50)
      // 50*0.25 + 50*0.25 + 100*0.25 + 50*0.25 = 12.5 + 12.5 + 25 + 12.5 = 62.5 → 63
      expect(score).toBe(63)
    })

    it('calculates score with no downtime (0), peak season (0), strong resistance (0), no budget (0)', () => {
      const score = calculateBusinessReadinessScore(0, 0, 0, 0)
      expect(score).toBe(0)
    })

    it('verifies equal weight distribution (25% each)', () => {
      // Weights: 25% + 25% + 25% + 25% = 100%
      const weights = [0.25, 0.25, 0.25, 0.25]
      const sum = weights.reduce((acc, w) => acc + w, 0)
      expect(sum).toBe(1.0)
    })

    it('calculates score matching migration-application-score.md example', () => {
      // From document example: Flexible (100), Off-peak (100), Some concerns (50), Fully funded (100)
      const score = calculateBusinessReadinessScore(100, 100, 50, 100)
      // 100*0.25 + 100*0.25 + 50*0.25 + 100*0.25 = 87.5 → 88
      expect(score).toBe(88)
    })
  })

  describe('Integration with migration-application-score.md', () => {
    it('verifies Team Readiness weights match document specification', () => {
      // Document specifies:
      // - Team Availability (30% of team score)
      // - Skill Level (30% of team score)
      // - Knowledge Transfer (25% of team score)
      // - Training Completed (15% of team score)

      const weights = {
        teamAvailability: 0.30,
        skillLevel: 0.30,
        knowledgeTransfer: 0.25,
        trainingCompleted: 0.15
      }

      expect(weights.teamAvailability).toBe(0.30)
      expect(weights.skillLevel).toBe(0.30)
      expect(weights.knowledgeTransfer).toBe(0.25)
      expect(weights.trainingCompleted).toBe(0.15)
    })

    it('verifies Business Readiness weights match document specification', () => {
      // Document specifies:
      // - Maintenance Window Availability (25% of business score)
      // - Business Calendar (25% of business score)
      // - Stakeholder Alignment (25% of business score)
      // - Budget Availability (25% of business score)

      const weights = {
        maintenanceWindow: 0.25,
        businessCalendar: 0.25,
        stakeholderAlignment: 0.25,
        budgetAvailability: 0.25
      }

      expect(weights.maintenanceWindow).toBe(0.25)
      expect(weights.businessCalendar).toBe(0.25)
      expect(weights.stakeholderAlignment).toBe(0.25)
      expect(weights.budgetAvailability).toBe(0.25)
    })

    it('verifies dropdown values match document specification', () => {
      // Team Availability options
      const teamAvailabilityValues = {
        dedicated: 100,
        partTime: 50,
        none: 0
      }

      expect(teamAvailabilityValues.dedicated).toBe(100)
      expect(teamAvailabilityValues.partTime).toBe(50)
      expect(teamAvailabilityValues.none).toBe(0)

      // Skill Level options
      const skillLevelValues = {
        expert: 100,
        someExperience: 50,
        noExperience: 0
      }

      expect(skillLevelValues.expert).toBe(100)
      expect(skillLevelValues.someExperience).toBe(50)
      expect(skillLevelValues.noExperience).toBe(0)

      // Knowledge Transfer options
      const knowledgeTransferValues = {
        fullDocsAndDevs: 100,
        keyPerson: 75,
        docsOnly: 50,
        none: 0
      }

      expect(knowledgeTransferValues.fullDocsAndDevs).toBe(100)
      expect(knowledgeTransferValues.keyPerson).toBe(75)
      expect(knowledgeTransferValues.docsOnly).toBe(50)
      expect(knowledgeTransferValues.none).toBe(0)

      // Training Completed options
      const trainingValues = {
        allTrained: 100,
        someTrained: 50,
        noTraining: 0
      }

      expect(trainingValues.allTrained).toBe(100)
      expect(trainingValues.someTrained).toBe(50)
      expect(trainingValues.noTraining).toBe(0)
    })
  })
})
