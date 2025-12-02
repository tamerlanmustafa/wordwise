// import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './utils/axiosInterceptor' // Initialize axios interceptor for token refresh
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  // <StrictMode>
    <App />
  // </StrictMode>,
)
