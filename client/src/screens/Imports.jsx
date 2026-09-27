import React, { useEffect, useState } from 'react'
import { api } from '../api.js'

// P2: CSV import (preview -> commit), research queue. Merge actions are
// reviewer-only and land via API; UI exposes the queue + import flow.
export default function ImportQueue() {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [commitResult, setCommitResult] = useState(null)
  const [tasks, setTasks] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function loadQueue() {
    try {
      const out = await api('/research')
      setTasks(out.tasks)
    } catch (ex) { setErr(ex.message) }
  }
  useEffect(() => { loadQueue() }, [])

  async function doPreview(e) {
    e.preventDefault(); setErr(''); setCommitResult(null); setPreview(null)
    if (!file) { setErr('Choose a CSV file first'); return }
    setBusy(true)
    try {
      const text = await file.text()
      const out = await api('/imports/preview', { method: 'POST', body: { filename: file.name, csv_text: text } })
      setPreview(out)
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  async function doCommit() {
    setErr(''); setBusy(true)
    try {
      const out = await api('/imports/commit', { method: 'POST', body: { import_id: preview.import_id } })
      setCommitResult(out)
      setPreview(null)
      loadQueue()
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  async function resolveTask(id, status) {
    try {
      await api(`/research/${id}/resolve`, { method: 'POST', body: { status } })
      loadQueue()
    } catch (ex) { setErr(ex.message) }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Import</h1>
          <div className="sub">Upload account lists (CSV). Preview before commit. Duplicates never auto-merge — a human decides.</div>
        </div>
      </div>
      {err && <div className="error">{err}</div>}

      <div className="card">
        <h2>New import</h2>
        <form onSubmit={doPreview} style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label>CSV file (max 4 MB, 5000 rows)</label>
            <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          <button className="btn" disabled={busy}>{busy ? 'Parsing…' : 'Preview'}</button>
        </form>

        {preview && (
          <div className="drawer" style={{ marginTop: 12 }}>
            <strong>Preview of {preview.filename_hint || 'file'}</strong>
            <div style={{ marginTop: 6, fontSize: 13.5 }}>
              {preview.total} rows · <span className="ok-note">{preview.valid} valid</span> ·{' '}
              {preview.duplicates.length} duplicates · {preview.candidates.length} possible matches ·{' '}
              <span style={{ color: 'var(--bad)' }}>{preview.errors.length} errors</span>
            </div>
            {preview.duplicates.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 13 }}>
                <strong>Duplicates (skipped on commit):</strong>
                {preview.duplicates.slice(0, 20).map((d) => (
                  <div key={d.row_number} className="count">row {d.row_number}: {d.reason}</div>
                ))}
              </div>
            )}
            {preview.candidates.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 13 }}>
                <strong>Possible matches (created + queued for review):</strong>
                {preview.candidates.slice(0, 20).map((c) => (
                  <div key={c.row_number} className="count">row {c.row_number}: {c.reasons.join('; ')}</div>
                ))}
              </div>
            )}
            {preview.errors.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 13 }}>
                <strong>Row errors (queued for research):</strong>
                {preview.errors.slice(0, 20).map((e) => (
                  <div key={e.row_number} className="count">row {e.row_number}: {e.error}</div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={doCommit} disabled={busy}>Commit {preview.valid - preview.duplicates.length} new organisations</button>
            </div>
          </div>
        )}

        {commitResult && (
          <div className="drawer" style={{ marginTop: 12 }}>
            <strong>Import committed.</strong>
            <div style={{ marginTop: 6, fontSize: 13.5 }}>
              Created {commitResult.created} · skipped {commitResult.duplicates} duplicates ·{' '}
              {commitResult.candidates_marked} queued for review · {commitResult.failed} failed rows queued.
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Research queue</h2>
        {tasks === null ? (
          <div className="empty">Loading…</div>
        ) : tasks.length === 0 ? (
          <div className="empty">Queue is clear.</div>
        ) : (
          <table>
            <thead><tr><th>Organisation</th><th>Reason</th><th></th></tr></thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.canonical_name || `import row ${t.import_row_id?.slice(0, 8)}`}</strong></td>
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
    </div>
  )
}
