import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { PreferencesProvider } from './lib/preferences'
import { SetupProvider } from './lib/setup'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <PreferencesProvider>
        <SetupProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </SetupProvider>
      </PreferencesProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
