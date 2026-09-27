import React, { useEffect, useState } from 'react'
import { api } from '../api.js'

// Intelligence = the research queue (what needs a human) + recent signals.
export default function Intelligence() {
  const [tasks, setTasks] = useState(null)
  const [signals, setSignals] = useState(null)
  const [err, setErr] = useState('')

  async function load() {
    setErr('')
    try {
      const t = await api('/research')
      setTasks(t.tasks || [])
    } catch (ex) { setErr(ex.message) }
    try {
      const s = await api('/signals')
      setSignals(s.signals || [])
    } catch { /* optional */ }
  }
  useEffect(() => { load() }, [])

  async function resolveTask(id, status) {
    try {
      await api(`/research/${id}/resolve`, { method: 'POST', body: { status } })
      load()
    } catch (ex) { setErr(ex.message) }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Research queue</h1>
          <div className="sub">What a human still needs to verify. Signals you captured, newest first.</div>
        </div>
      </div>
      {err && <div className="error">{err}</div>}

      <div className="card">
        <h2>Needs review</h2>
        {tasks === null ? (
          <div className="empty">Loading…</div>
        ) : tasks.length === 0 ? (
          <div className="empty">Queue is clear.</div>
        ) : (
          <table className="rows">
            <thead><tr><th>Company</th><th>Why</th><th></th></tr></thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.canonical_name || `import row ${(t.import_row_id || '').slice(0, 8)}`}</strong></td>
                  <td>{t.reason}</td>
                  <td>
                    <button className="btn small" onClick={() => resolveTask(t.id, 'done')}>Done</button>{' '}
                    <button className="btn secondary small" onClick={() => resolveTask(t.id, 'dismissed')}>Dismiss</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Signals captured</h2>
        {signals === null ? (
          <div className="empty">Loading…</div>
        ) : signals.length === 0 ? (
          <div className="empty">No signals yet. Every idea you capture lands here as a signal too.</div>
        ) : (
          <table className="rows">
            <thead><tr><th>Type</th><th>What happened</th><th>When</th></tr></thead>
            <tbody>
              {signals.map((s) => (
                <tr key={s.id}>
                  <td><span className="chip stage">{s.event_type}</span></td>
                  <td>{s.summary}</td>
                  <td className="count">{String(s.occurred_at || s.created_at || '').slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
