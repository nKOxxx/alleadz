import React, { useEffect, useState } from 'react'
import { api } from '../api.js'

// P1 scope: navigation shell + empty state. Signals/queue land in P2/P3.
export default function Intelligence() {
  const [state, setState] = useState('loading')

  useEffect(() => {
    let dead = false
    api('/signals')
      .then(() => { if (!dead) setState('ready') })
      .catch((ex) => { if (!dead) setState(ex.status === 404 ? 'pending' : 'error') })
    return () => { dead = true }
  }, [])

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Intelligence</h1>
          <div className="sub">Signals in, hard checks, contradiction review, research queue.</div>
        </div>
      </div>
      <div className="card">
        {state === 'loading' && <div className="empty">Loading…</div>}
        {state === 'pending' && (
          <div className="empty">
            Signal capture and the research queue land in Phases 2–3.
            This screen will show: incoming signals, their hard-check verdicts,
            and the contradictions a human reviewer must resolve.
          </div>
        )}
        {state === 'error' && <div className="error">Could not load intelligence.</div>}
        {state === 'ready' && <div className="empty">No signals recorded yet.</div>}
      </div>
    </div>
  )
}
