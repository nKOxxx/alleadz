import React, { useEffect, useState } from 'react'
import { api } from '../api.js'

// P1 scope: navigation shell + empty state. The thesis engine (P3) fills this.
export default function Opportunities() {
  const [state, setState] = useState('loading')
  const [rows, setRows] = useState([])

  useEffect(() => {
    let dead = false
    api('/opportunities')
      .then((out) => { if (!dead) { setRows(out.opportunities || []); setState('ready') } })
      .catch((ex) => { if (!dead) setState(ex.status === 404 ? 'pending' : 'error') })
    return () => { dead = true }
  }, [])

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Opportunities</h1>
          <div className="sub">Change → evidence-linked thesis → decision owner → approach.</div>
        </div>
      </div>
      <div className="card">
        {state === 'loading' && <div className="empty">Loading…</div>}
        {state === 'pending' && (
          <div className="empty">
            The opportunity thesis engine lands in Phase 3 (signals, hard checks, rubric, nine sections).
            Until then, build your foundation: import accounts (Phase 2) and attach twins.
          </div>
        )}
        {state === 'error' && <div className="error">Could not load opportunities.</div>}
        {state === 'ready' && (rows.length === 0
          ? <div className="empty">No opportunities yet.</div>
          : (
            <table>
              <thead><tr><th>Target</th><th>Stage</th><th>Score</th><th>Updated</th></tr></thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td><strong>{o.target_name}</strong></td>
                    <td><span className="chip stage">{o.stage}</span></td>
                    <td>{o.rubric_total ?? '—'}</td>
                    <td className="count">{String(o.updated_at || '').slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </div>
    </div>
  )
}
