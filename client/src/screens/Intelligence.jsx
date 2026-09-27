import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Status, Callout } from 'twenty-ui'

// Intelligence = research queue + signals + triage (analyze a discovery snapshot,
// inspect evidence, promote findings to claims).
const SIGNAL_COLORS = {
  funding: 'green', hiring: 'sky', product_launch: 'violet', partnership: 'blue',
  expansion: 'purple', idea: 'orange', none: 'gray',
}

export default function Intelligence() {
  const [tasks, setTasks] = useState(null)
  const [signals, setSignals] = useState(null)
  const [runs, setRuns] = useState(null)
  const [err, setErr] = useState('')
  const [detail, setDetail] = useState(null)   // signal detail payload
  const [promoting, setPromoting] = useState(null) // finding being promoted
  const [busy, setBusy] = useState(false)

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
    try {
      const d = await api('/discovery/runs')
      setRuns((d.runs || []).filter((r) => r.status === 'ok').slice(0, 20))
    } catch { /* optional */ }
  }
  useEffect(() => { load() }, [])

  async function resolveTask(id, status) {
    try {
      await api(`/research/${id}/resolve`, { method: 'POST', body: { status } })
      load()
    } catch (ex) { setErr(ex.message) }
  }

  async function analyze(runId) {
    setBusy(true); setErr('')
    try {
      await api('/discovery/analyze', { method: 'POST', body: { run_id: runId } })
      load()
    } catch (ex) { setErr(ex.message) }
    setBusy(false)
  }

  async function openSignal(id) {
    setErr('')
    try {
      const d = await api(`/signals/${id}`)
      setDetail(d)
    } catch (ex) { setErr(ex.message) }
  }

  async function promote(finding) {
    setBusy(true); setErr('')
    try {
      const orgId = detail.orgs[0]?.id
      if (!orgId) throw new Error('Link the signal to a company first (edit affected orgs via capture).')
      await api(`/signals/${detail.signal.id}/promote`, { method: 'POST', body: {
        predicate: finding.predicate, value: finding.excerpt.slice(0, 300), organisation_id: orgId,
      } })
      setPromoting(null)
      await openSignal(detail.signal.id)
    } catch (ex) { setErr(ex.message) }
    setBusy(false)
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Intelligence</h1>
          <div className="sub">Signals in, evidence checked, findings promoted to claims. Deterministic — no vibes.</div>
        </div>
      </div>
      {err && <Callout variant="danger" title="Couldn't complete">{err}</Callout>}

      <div className="card">
        <h2>Unanalyzed snapshots</h2>
        {runs === null ? (
          <div className="empty">Loading…</div>
        ) : runs.length === 0 ? (
          <div className="empty">No discovery snapshots yet. Fetch pages from a company record first.</div>
        ) : (
          <table className="rows">
            <thead><tr><th>Page</th><th>Fetched</th><th></th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{(r.final_url || r.requested_url).slice(0, 80)}</td>
                  <td className="count">{String(r.created_at).slice(0, 10)}</td>
                  <td>
                    <button className="btn small" disabled={busy} onClick={() => analyze(r.id)}>Triage</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
          <div className="empty">No signals yet. Triage a snapshot above or capture an idea.</div>
        ) : (
          <table className="rows">
            <thead><tr><th>Type</th><th>What happened</th><th>When</th><th></th></tr></thead>
            <tbody>
              {signals.map((s) => (
                <tr key={s.id}>
                  <td><Status color={SIGNAL_COLORS[s.event_type] || 'gray'} weight="bold">{s.event_type}</Status></td>
                  <td>{s.summary.slice(0, 160)}{s.summary.length > 160 ? '…' : ''}</td>
                  <td className="count">{String(s.occurred_at || s.created_at || '').slice(0, 10)}</td>
                  <td><button className="btn secondary small" onClick={() => openSignal(s.id)}>Evidence</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detail && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2>Signal evidence</h2>
            <button className="btn secondary small" onClick={() => setDetail(null)}>Close</button>
          </div>
          <p>{detail.signal.summary}</p>
          <h3>Sources</h3>
          {detail.sources.length === 0 ? <div className="empty">No sources — idea captured without evidence.</div> : (
            <ul>
              {detail.sources.map((s) => (
                <li key={s.id}>
                  <a href={s.url} target="_blank" rel="noreferrer">{s.publisher || s.url}</a>
                  {s.published_at ? ` — published ${String(s.published_at).slice(0, 10)}` : ''}
                  {s.excerpt ? <div className="count">{s.excerpt.slice(0, 240)}</div> : null}
                </li>
              ))}
            </ul>
          )}
          <h3>Linked companies</h3>
          {detail.orgs.length === 0 ? <div className="empty">None.</div> : (
            <p>{detail.orgs.map((o) => o.canonical_name).join(', ')}</p>
          )}
          <h3>Claims promoted from this signal</h3>
          {detail.claims.length === 0 ? <div className="empty">None yet — promote a finding below.</div> : (
            <ul>
              {detail.claims.map((c) => (
                <li key={c.id}>
                  <code>{c.predicate}</code> = {String(c.value?.text ?? JSON.stringify(c.value)).slice(0, 200)}
                  {' '}· <Status color="green" weight="medium">{c.assertion_type}</Status>
                </li>
              ))}
            </ul>
          )}
          {detail.sources.length > 0 && detail.orgs.length > 0 && (
            <>
              <h3>Promote a claim</h3>
              <p className="count">Only from this signal's evidence. Claim will cite the sources above (sourced_fact).</p>
              {(detail.signal.summary.split(' | ') || []).filter((p) => p.includes(': ')).map((part, i) => {
                const idx = part.indexOf(': ')
                const label = part.slice(0, idx)
                const excerpt = part.slice(idx + 2)
                const PRED = {
                  'Funding announcement': 'funding_stage',
                  'Hiring signal': 'hiring',
                  'Product launch': 'product_launch',
                  'Partnership': 'partnership',
                  'Market/office expansion': 'expansion',
                }
                return (
                  <div key={i} style={{ margin: '6px 0' }}>
                    <button className="btn small" disabled={busy} onClick={() => promote({
                      predicate: PRED[label] || 'finding',
                      excerpt,
                    })}>Promote “{label}”</button>
                    <span className="count"> {excerpt?.slice(0, 100)}…</span>
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}
