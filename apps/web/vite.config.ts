import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { normalizeSnapshot } from '../../packages/transit-engine/src/normalize'
import routes from '../../packages/transit-engine/assets/routes.min.json'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-transit-source',
      configureServer(server) {
        server.middlewares.use('/api/v1/snapshot', async (_request, response) => {
          try {
            const base = 'https://ucirvine.transloc.com/Services/JSONPRelay.svc/'
            const [vehicles, arrivals] = await Promise.all([
              fetch(`${base}GetMapVehiclePoints`).then(value => value.json()),
              fetch(`${base}GetStopArrivalTimes?routeIds=${routes.routes.map(route => route.id.replace(/^TL-/, '')).join(',')}&version=2`).then(value => value.json())
            ])
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify(normalizeSnapshot(vehicles, arrivals)))
          } catch {
            response.statusCode = 502
            response.end(JSON.stringify({ error: 'Live transit is unavailable' }))
          }
        })
      }
    },
    VitePWA({
      injectRegister: null,
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'ZotStop',
        short_name: 'ZotStop',
        description: 'Campus bus routes and live arrivals',
        theme_color: '#ffffff',
        background_color: '#f7f8f5',
        display: 'standalone',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }]
      },
      workbox: { navigateFallback: '/index.html', globPatterns: ['**/*.{js,css,html,svg,png,json,geojson,woff2}'], runtimeCaching: [{ urlPattern: /\/api\/v1\/snapshot$/, handler: 'NetworkFirst', options: { cacheName: 'live-transit', expiration: { maxEntries: 1, maxAgeSeconds: 30 }, networkTimeoutSeconds: 3 } }] }
    })
  ]
})
