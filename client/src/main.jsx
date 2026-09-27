import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import '@fontsource-variable/inter'
import './styles.css'
import { AuthProvider, useAuth } from './state.jsx'
import { Login, Register } from './screens/Login.jsx'
import Shell from './screens/Shell.jsx'
import Organisations from './screens/Organisations.jsx'
import Opportunities from './screens/Opportunities.jsx'
import Intelligence from './screens/Intelligence.jsx'
import Actions from './screens/Actions.jsx'

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
            <Route index element={<Opportunities />} />
            <Route path="opportunities" element={<Opportunities />} />
            <Route path="intelligence" element={<Intelligence />} />
            <Route path="organisations" element={<Organisations />} />
            <Route path="actions" element={<Actions />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
