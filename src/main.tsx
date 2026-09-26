import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './print.css'
import App from './App.tsx'
import { installStaleBuildRecovery } from './state/staleBuild'

// A tab older than the latest deploy asks for lazy files that no longer
// exist; this reloads it into the new build. See `state/staleBuild.ts`.
installStaleBuildRecovery()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
