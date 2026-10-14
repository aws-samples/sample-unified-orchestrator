import axios from 'axios'

/**
 * Dedicated axios client for the automations (hafcore) backend.
 *
 * In production the ALB listener rule at priority 5 matches
 * /api/v1/automations/* and forwards to the hafcore target group.
 *
 * In local dev, set VITE_AUTOMATIONS_API_BASE_URL to point at
 * your local hafcore API (e.g. http://localhost:8080/api/v1/automations).
 */
const automationsClient = axios.create({
  baseURL: import.meta.env.VITE_AUTOMATIONS_API_BASE_URL || '/api/v1/automations',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

automationsClient.interceptors.request.use(
  (config) => {
    return config
  },
  (error) => Promise.reject(error),
)

export default automationsClient
