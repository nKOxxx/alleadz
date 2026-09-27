import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { Avatar, Banner, Status } from 'twenty-ui'

const STAGE_COLOR = {
  candidate: 'gray',
  researching: 'sky',
  thesis_ready: 'blue',
  human_reviewed: 'violet',
  qualifying: 'purple',
  qualified: 'green',
  handed_off: 'jade',
}

const STAGES = ['candidate', 'researching', 'thesis_ready', 'human_reviewed', 'qualifying', 'qualified', 'handed_off']

export default function Pipeline() {
  const { id } = useParams()
  return id ? <Record id={id} /> : <List />
}

function List() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    api('/opportunities').then((out) => setRows(out.opportunities || [])).catch((ex) => setErr(ex.message))
  }, [])

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Pipeline</h1>
          <div className="sub">Every idea you acted on, from first capture to hand-off. Click one to work it.</div>
        </div>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="card">
        {rows === null ? <div className="empty">Loading…</div> : rows.length === 0 ? (
          <div className="empty">Nothing here yet — use <strong>“I have an idea”</strong> on the left to capture your first opportunity.</div>
        ) : (
          <table className="rows">
            <thead><tr><th>Target</th><th>Stage</th><th>Priority</th><th>Updated</th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <Row key={o.id} o={o} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function Row({ o }) {
  const navigate = useNavigate()
  return (
    <tr className="clickable" onClick={() => navigate(`/pipeline/${o.id}`)}>
      <td><strong>{o.target_name || 'Untitled'}</strong></td>
      <td><Status color={STAGE_COLOR[o.stage] || 'gray'} weight="medium">{o.stage.replace('_', ' ')}</Status></td>
      <td>{o.priority != null ? `${o.priority}/100` : '—'}</td>
      <td className="count">{String(o.updated_at || '').slice(0, 10)}</td>
    </tr>
  )
}

function Record({ id }) {
  const [opp, setOpp] = useState(null)
  const [err, setErr] = useState('')
  const [thesis, setThesis] = useState(null)
  const [plan, setPlan] = useState(null)
  const [people, setPeople] = useState([])
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function load() {
    try {
      const out = await api(`/opportunities/${id}`)
      setOpp(out.opportunity || out)
      const th = (out.opportunity || out).theses || []
      setThesis(th.length ? th[th.length - 1] : null)
    } catch (ex) { setErr(ex.message) }
    try {
      const plans = await api(`/plans?opportunity_id=${id}`)
      setPlan((plans.plans || [])[0] || null)
    } catch { /* optional */ }
    try {
      const p = await api('/people')
      setPeople(p.people || [])
    } catch { /* optional */ }
  }
  useEffect(() => { load() }, [id])

  async function transition(to) {
    setBusy(true); setErr('')
    try {
      await api(`/opportunities/${id}/transitions`, { method: 'POST', body: { to } })
      await load()
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  async function generateThesis() {
    setBusy(true); setErr('')
    try {
      await api('/theses', { method: 'POST', body: { opportunity_id: id } })
      await load()
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  async function createPlan() {
    setBusy(true); setErr('')
    try {
      await api('/plans', { method: 'POST', body: { opportunity_id: id, title: `Approach ${opp?.target_name || 'target'}` } })
      await load()
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  if (!opp) return <div className="empty">{err || 'Loading…'}</div>
  const stageIdx = STAGES.indexOf(opp.stage)
  const nextStage = STAGES[stageIdx + 1]

  return (
    <div>
      <div className="page-head">
        <div>
          <button className="crumb" onClick={() => navigate('/pipeline')}>← Pipeline</button>
          <h1>{opp.target_name || 'Opportunity'}</h1>
          <div className="sub"><Status color={STAGE_COLOR[opp.stage] || 'gray'} weight="medium">{opp.stage.replace('_', ' ')}</Status> · sector: {opp.sector_type} · created {String(opp.created_at || '').slice(0, 10)}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn secondary" disabled={busy} onClick={generateThesis}>Draft thesis</button>
          {nextStage && <button className="btn" disabled={busy} onClick={() => transition(nextStage)}>Move to {nextStage} →</button>}
        </div>
      </div>
      {err && <div className="error">{err}</div>}

      <div className="stagebar">
        {STAGES.map((s, i) => (
          <div key={s} className={`stagestep${i <= stageIdx ? ' done' : ''}${i === stageIdx ? ' now' : ''}`}>{s.replace('_', ' ')}</div>
        ))}
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Thesis</h2>
          {!thesis ? (
            <Banner color="blue">
              No thesis yet. “Draft thesis” runs the deterministic rubric — every claim must be
              evidence-cited or explicitly framed as a hypothesis. Nothing scores on vibes.
            </Banner>
          ) : (
            <div>
              <div style={{ display: 'flex', gap: 14, marginBottom: 8 }}>
                <div><div className="big-num">{thesis.priority ?? '—'}</div><div className="count">priority</div></div>
                <div><div className="big-num">{thesis.coverage ?? '—'}</div><div className="count">coverage</div></div>
                <div><div className="big-num">{thesis.confidence ?? '—'}</div><div className="count">confidence</div></div>
              </div>
              <div className="count">v{thesis.version} · {String(thesis.created_at || '').slice(0, 10)}
                {thesis.needs_reassessment ? ' · needs reassessment' : ''}</div>
            </div>
          )}
        </div>

        <div className="card">
          <h2>Approach</h2>
          {!plan ? (
            <div>
              <div className="empty" style={{ padding: '12px 6px' }}>No action plan yet.</div>
              <button className="btn" disabled={busy} onClick={createPlan}>Create approach plan</button>
            </div>
          ) : (
            <div>
              <strong>{plan.title}</strong>
              <div className="count" style={{ marginTop: 4 }}>
                Plan created · add tasks and request approval on the <a href="/approvals">Approvals</a> board.
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2>People at this company</h2>
        {(people.filter((p) => p.organisation_id === opp.target_org_id)).length === 0 ? (
          <div className="empty">
            Nobody recorded yet. Add decision-makers under <strong>People &amp; contacts</strong> — outreach needs a real, published contact before approval can bind.
          </div>
        ) : (
          <table className="rows">
            <thead><tr><th>Name</th><th>Role</th><th>Seniority</th></tr></thead>
            <tbody>
              {people.filter((p) => p.organisation_id === opp.target_org_id).map((p) => (
                <tr key={p.id}>
                  <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Avatar name={p.full_name} size="sm" colorSeed={p.id} />
                    <strong>{p.full_name}</strong>
                  </td>
                  <td>{p.role_title || '—'}</td>
                  <td>{p.seniority || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
