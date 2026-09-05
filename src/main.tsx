import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { loadConfig } from './lib/config'
import './styles/index.css'

// HashRouter, not BrowserRouter: the built app is a folder of static files
// that gets opened from a USB stick or a plain file server at events, where
// there is no server to rewrite deep links.
// config.json is read before the first render so the TBA key, event and
// season are in place by the time any screen asks for them.
loadConfig().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </React.StrictMode>,
  )
})
