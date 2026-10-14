import axios from 'axios'
import { isDevMode } from './auth'
import { getAccessToken, clearTokens, login } from './pkceAuth'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1'

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Attach Bearer token to every request
apiClient.interceptors.request.use(
  (config) => {
    if (isDevMode()) {
      return config
    }

    const token = getAccessToken()
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Handle 401 responses — clear tokens and redirect to PKCE login
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !isDevMode()) {
      clearTokens()
      login()
    }
    return Promise.reject(error)
  }
)

export default apiClient
