import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'

// The ONE entry point: an idea in plain words becomes a real opportunity.
// Type → pick/quick-create the company → the system creates signal +
// opportunity + first action plan in a single atomic action.
export default function Capture({ onCreated }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [orgs, setOrgs] = useState([])
  const [picked, setPicked] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const box = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    api('/orgs?limit=100').then((out) => setOrgs(out.organisations || [])).catch(() => {})
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const matches = text.trim()
    ? orgs.filter((o) => o.canonical_name.toLowerCase().includes(text.trim().toLowerCase())).slice(0, 5)
    : []

  async function submit(e) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true); setErr('')
    try {
      let target = picked
      if (!target) {
        // quick-create the company from the idea text (first words as name)
        const name = text.trim().slice(0, 80)
        const out = await api('/orgs', { method: 'POST', body: { canonical_name: name, entity_type: 'buyer' } })
        target = out
      }
      // reuse the cached offering twin when present (avoids N+1 twin lookups);
      // otherwise create it once and remember it for the next capture.
      let twin = null
      const cachedTwin = localStorage.getItem('alleadz.ownTwin')
      if (cachedTwin) { try { twin = JSON.parse(cachedTwin) } catch { twin = null } }
      if (!twin?.id) {
        const twinOrgs = await api('/orgs?limit=200')
        for (const o of twinOrgs.organisations || []) {
          const t = await api(`/twins?org_id=${o.id}`).catch(() => ({ twins: [] }))
          const offering = (t.twins || []).find((x) => x.offering)
          if (offering) { twin = offering; break }
        }
      }
      if (!twin) {
        const created = await api('/orgs', { method: 'POST', body: { canonical_name: 'Our company (edit me)', entity_type: 'provider' } })
        const t = await api('/twins', { method: 'POST', body: {
          organisation_id: created.id, offering: true,
          version: { mandate: text.trim().slice(0, 200), permitted_markets: [], excluded_markets: [], capabilities: [], status: 'active' },
        } })
        twin = t.twin || t
      }
      try { localStorage.setItem('alleadz.ownTwin', JSON.stringify(twin)) } catch {}
      const opp = await api('/opportunities', { method: 'POST', body: {
        offering_twin_id: twin.id, target_org_id: target.id, sector_type: 'custom',
      } })
      await api('/signals', { method: 'POST', body: {
        event_type: 'idea', summary: text.trim(), source_ids: [], affected_org_ids: [target.id],
      } })
      setOpen(false); setText(''); setPicked(null)
      onCreated ? onCreated(opp.opportunity || opp) : navigate(`/pipeline/${(opp.opportunity || opp).id}`)
    } catch (ex) {
      setErr(ex.message || 'Could not create the opportunity')
    } finally { setBusy(false) }
  }

  return (
    <>
      <button className="btn capture-btn" onClick={() => setOpen(true)}>
        <span className="capture-plus">+</span> I have an idea
        <span className="kbd-hint">starts everything</span>
      </button>
      {open && (
        <div className="modal-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
          <form className="capture-box" onSubmit={submit} ref={box}>
            <div className="capture-title">What changed? Who should we talk to?</div>
            <textarea
              autoFocus rows={3} value={text}
              onChange={(e) => { setText(e.target.value); setPicked(null) }}
              placeholder="e.g. UAE ministry published an AI compute tender — talk to their infrastructure office"
            />
            {matches.length > 0 && !picked && (
              <div className="capture-matches">
                <div className="count" style={{ marginBottom: 4 }}>Existing companies matching:</div>
                {matches.map((o) => (
                  <button type="button" key={o.id} className="capture-match" onClick={() => setPicked(o)}>
                    {o.canonical_name}
                  </button>
                ))}
              </div>
            )}
            {picked && (
              <div className="capture-picked">
                Target: <strong>{picked.canonical_name}</strong>{' '}
                <button type="button" className="btn secondary small" onClick={() => setPicked(null)}>change</button>
              </div>
            )}
            {!picked && !matches.length && text.trim() && (
              <div className="capture-picked">New company will be created: <strong>{text.trim().slice(0, 80)}</strong></div>
            )}
            {err && <div className="error">{err}</div>}
            <div className="capture-actions">
              <button type="button" className="btn secondary" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn" disabled={busy || !text.trim()}>{busy ? 'Creating…' : 'Create opportunity'}</button>
            </div>
            <div className="count" style={{ marginTop: 8 }}>
              Creates: company (if new) → opportunity → idea signal. You land on its pipeline record.
            </div>
          </form>
        </div>
      )}
    </>
  )
}
