import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Banner, Status } from 'twenty-ui'

// Approvals board: what's ready to send, what's blocked and why.
// The law stands: the system never sends — a human exports and sends.
export default function Approvals() {
  const [tasks, setTasks] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setErr('')
    try {
      const out = await api('/tasks')
      setTasks(out.tasks || [])
    } catch (ex) { setErr(ex.message) }
  }
  useEffect(() => { load() }, [])

  const live = (t) => t.approval_id && !t.revoked_at && new Date(t.expires_at) > new Date()

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Approvals</h1>
          <div className="sub">Outreach tasks and their approval state. Nothing sends itself — export is always a human click.</div>
        </div>
        <button className="btn secondary" onClick={load}>Refresh</button>
      </div>
      {err && <div className="error">{err}</div>}

      <Banner color="blue" variant="secondary">
        The system never sends. A live approval only unlocks the export button — a human
        downloads the bundle and sends it. Approvals expire and can be revoked instantly.
      </Banner>

      <div className="card">
        {tasks === null ? (
          <div className="empty">Loading…</div>
        ) : tasks.length === 0 ? (
          <div className="empty">
            No outreach tasks yet. Open an opportunity in the <strong>Pipeline</strong>, create its approach plan, then add tasks to it.
          </div>
        ) : (
          <table className="rows">
            <thead><tr><th>Task</th><th>Target</th><th>Plan</th><th>Approval</th><th></th></tr></thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td><strong>#{t.sequence}</strong> {t.kind}</td>
                  <td>{t.target_name || '—'}</td>
                  <td className="count">{t.plan_title || '—'}</td>
                  <td>
                    {!t.approval_id
                      ? <Status color="gray">not requested</Status>
                      : t.revoked_at
                        ? <Status color="red">revoked</Status>
                        : live(t)
                          ? <Status color="green" weight="medium">live · expires {String(t.expires_at).slice(0, 10)}</Status>
                          : <Status color="orange">expired</Status>}
                  </td>
                  <td>
                    {live(t) && (
                      <a className="btn small" style={{ textDecoration: 'none' }}
                        href={`/api/tasks/${t.id}/export`}>
                        Export bundle
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
