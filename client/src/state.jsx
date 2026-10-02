// client/src/state.jsx — auth + tenant context (persisted across reload = A02 UX law)
import React, { createContext, useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getToken, setToken, getTenant, setTenant, api } from './api.js'

const Ctx = createContext(null)

export function AuthProvider({ children }) {
  const [token, setTok] = useState(getToken())
  const [tenant, setTen] = useState(getTenant())
  const [ready, setReady] = useState(false)
  const navigate = useNavigate()

  useEffect(() => { setReady(true) }, [])

  const value = {
    token,
    tenant,
    ready,
    async login(email, password) {
      const out = await api('/auth/login', { method: 'POST', body: { email, password } })
      setToken(out.token); setTok(out.token)
      if (out.tenant) { setTenant(out.tenant); setTen(out.tenant) }
      return out
    },
    async register(email, password, workspaceName) {
      const out = await api('/auth/register', { method: 'POST', body: { email, password, workspaceName } })
      setToken(out.token); setTok(out.token)
      setTenant(out.tenant); setTen(out.tenant)
      return out
    },
    switchTenant(t) { setTenant(t); setTen(t) },
    logout() {
      api('/auth/logout', { method: 'POST' }).catch(() => {})
      setToken(null); setTok(null); setTenant(null); setTen(null)
      navigate('/login')
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() { return useContext(Ctx) }
