import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../state.jsx'

export function Login() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      await login(email, password)
      window.location.href = '/'
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="wordmark"><span className="ring" /> ALLEADZ</div>
      <div className="tag">Intelligence to opportunity. Sign in to your workspace.</div>
      {err && <div className="error">{err}</div>}
      <form onSubmit={submit}>
        <label>Email</label>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        <label>Password</label>
        <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        <div style={{ marginTop: 14 }}>
          <button className="btn" disabled={busy} style={{ width: '100%' }}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </div>
      </form>
      <div className="alt">No workspace yet? <Link to="/register">Create one</Link></div>
    </div>
  )
}

export function Register() {
  const { register } = useAuth()
  const [form, setForm] = useState({ email: '', password: '', workspaceName: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      await register(form.email, form.password, form.workspaceName || 'My Workspace')
      window.location.href = '/'
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="wordmark"><span className="ring" /> ALLEADZ</div>
      <div className="tag">Create your workspace. You are its first admin.</div>
      {err && <div className="error">{err}</div>}
      <form onSubmit={submit}>
        <label>Workspace name</label>
        <input required value={form.workspaceName} onChange={set('workspaceName')} placeholder="Acme Intelligence" />
        <label>Email</label>
        <input type="email" required value={form.email} onChange={set('email')} placeholder="you@company.com" />
        <label>Password (min 8 chars)</label>
        <input type="password" required minLength={8} value={form.password} onChange={set('password')} placeholder="••••••••" />
        <div style={{ marginTop: 14 }}>
          <button className="btn" disabled={busy} style={{ width: '100%' }}>{busy ? 'Creating…' : 'Create workspace'}</button>
        </div>
      </form>
      <div className="alt">Already have access? <Link to="/login">Sign in</Link></div>
    </div>
  )
}
