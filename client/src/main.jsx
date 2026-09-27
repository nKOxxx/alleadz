import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import '@fontsource-variable/inter'
import './styles.css'
import { AuthProvider, useAuth } from './state.jsx'
import { Login, Register } from './screens/Login.jsx'
import Shell from './screens/Shell.jsx'
import Pipeline from './screens/Pipeline.jsx'
import Companies from './screens/Companies.jsx'
import People from './screens/People.jsx'
import Intelligence from './screens/Intelligence.jsx'
import Imports from './screens/Imports.jsx'
import Approvals from './screens/Approvals.jsx'

function Gate({ children }) {
  const { token, ready } = useAuth()
  if (!ready) return <div className="boot">Loading…</div>
  if (!token) return <Navigate to="/login" replace />
  return children
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/" element={<Gate><Shell /></Gate>}>
            <Route index element={<Pipeline />} />
            <Route path="pipeline" element={<Pipeline />} />
            <Route path="pipeline/:id" element={<Pipeline />} />
            <Route path="companies" element={<Companies />} />
            <Route path="people" element={<People />} />
            <Route path="intelligence" element={<Intelligence />} />
            <Route path="imports" element={<Imports />} />
            <Route path="approvals" element={<Approvals />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
