import React from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../state.jsx'
import { useEffect } from 'react'
import { api } from '../api.js'

export default function Shell() {
  const { tenant, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="shell">
      <nav className="sidenav">
        <div className="wordmark"><span className="ring" /> ALLEADZ</div>
        <NavLink to="/opportunities" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>Opportunities</NavLink>
        <NavLink to="/intelligence" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>Intelligence</NavLink>
        <NavLink to="/organisations" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>Organisations</NavLink>
        <NavLink to="/actions" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>Actions</NavLink>
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
