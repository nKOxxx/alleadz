import React, { useEffect, useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../state.jsx'
import { api } from '../api.js'
import Capture from './Capture.jsx'

export default function Shell() {
  const { tenant, logout } = useAuth()
  const navigate = useNavigate()
  const [counts, setCounts] = useState({})

  useEffect(() => {
    // light counters for the sidebar badges; failures are non-fatal
    Promise.allSettled([
      api('/research'),
      api('/tasks'),
    ]).then(([rq, tq]) => {
      setCounts({
        research: rq.status === 'fulfilled' ? (rq.value.tasks || []).length : 0,
        approvals: tq.status === 'fulfilled'
          ? (tq.value.tasks || []).filter((t) => t.approval_id && !t.revoked_at && new Date(t.expires_at) > new Date()).length
          : 0,
      })
    })
  }, [])

  return (
    <div className="shell">
      <nav className="sidenav">
        <div className="wordmark"><span className="ring" /> ALLEADZ</div>
        <Capture onCreated={(opp) => navigate(`/pipeline/${opp.id}`)} />
        <div className="nav-group">
          <div className="nav-label">Work</div>
          <NavLink to="/pipeline" end className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>Pipeline</NavLink>
          <NavLink to="/approvals" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            Approvals{counts.approvals ? <span className="badge">{counts.approvals}</span> : null}
          </NavLink>
          <NavLink to="/intelligence" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            Research queue{counts.research ? <span className="badge">{counts.research}</span> : null}
          </NavLink>
        </div>
        <div className="nav-group">
          <div className="nav-label">Records</div>
          <NavLink to="/companies" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>Companies</NavLink>
          <NavLink to="/people" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>People &amp; contacts</NavLink>
          <NavLink to="/imports" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>Import</NavLink>
        </div>
        <div className="side-foot">
          Workspace: {tenant?.name}
          <button className="btn secondary small" style={{ marginTop: 8, width: '100%' }} onClick={logout}>Sign out</button>
        </div>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
