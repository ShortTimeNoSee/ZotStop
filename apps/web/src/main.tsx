import React from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles/tokens.css'
import './styles/app.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={() => (
      <main className="app-failure" role="alert">
        <h1>ZotStop couldn't open.</h1>
        <button onClick={() => window.location.reload()}>Reload ZotStop</button>
        <a href="https://shuttle.uci.edu/">View official service</a>
      </main>
    )}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
if (!Capacitor.isNativePlatform()) registerSW({ immediate: true })
