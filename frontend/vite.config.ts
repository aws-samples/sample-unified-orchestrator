import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const araApiUrl = env.VITE_ARA_API_URL || 'http://localhost:5000'
  // bootkare edit — SMO backend URL
  const smoApiUrl = env.VITE_SMO_API_URL || 'http://localhost:3001'

  return {
    plugins: [react({
      // Enable Fast Refresh for React components
      fastRefresh: true,
    })],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 3000,
      host: true,
      // Proxy API requests to the appropriate backend
      proxy: {
        // ARA endpoints (risk, patterns, applications) → ARA backend
        '/api/v1/ara': {
          target: araApiUrl,
          changeOrigin: true,
          // Required for SSE (Server-Sent Events) — disable response buffering
          headers: { 'X-Accel-Buffering': 'no' },
        },
        // Migration Refinery endpoints → migration-refinery backend
        '/mr-api': {
          target: env.VITE_MIGRATION_REFINERY_API_URL || 'http://localhost:8080',
          changeOrigin: true,
          rewrite: (p: string) => p.replace(/^\/mr-api/, '/api'),
        },
        // bootkare edit — SMO endpoints → SMO backend
        '/api/v1/smo': {
          target: smoApiUrl,
          changeOrigin: true,
        },
        // Automations (IAC Agent) → orchestration-core backend
        '/api/v1/automations': {
          target: env.VITE_ORCHESTRATION_CORE_API_URL || 'http://localhost:8081',
          changeOrigin: true,
        },
        // Everything else (wave, health, auth) → UNO backend
        '/api': {
          target: 'http://localhost:6001',
          changeOrigin: true,
        },
      },
      // Enable hot module replacement
      hmr: {
        overlay: true,
      },
      watch: {
        usePolling: false,
        interval: 100,
      },
    },
    preview: {
      port: 3000
    },
    build: {
      target: 'esnext',
    }
  }
})
