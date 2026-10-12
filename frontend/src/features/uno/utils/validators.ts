export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export function validateRequired(value: string): boolean {
  return value.trim().length > 0
}

export function validateDateRange(startDate: string, endDate: string): boolean {
  const start = new Date(startDate)
  const end = new Date(endDate)
  return end > start
}

export function validateLength(value: string, min: number, max: number): boolean {
  const length = value.trim().length
  return length >= min && length <= max
}
