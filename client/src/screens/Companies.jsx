import React, { useEffect, useState } from 'react'
import { api } from '../api.js'

// Companies = CRM companies table (Twenty-style object dashboard).
// Inline create, twin drawer, click-through to people.
export default function Companies() {
  const [orgs, setOrgs] = useState(null)
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(50)
  const [offset, setOffset] = useState(0)
  const [err, setErr] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [q, setQ] = useState('')

  const [form, setForm] = useState({ canonical_name: '', entity_type: 'buyer', domains: '', country: '' })
  const [twinOrg, setTwinOrg] = useState(null)
  const [twinForm, setTwinForm] = useState({ offering: false, mandate: '', capabilities: '' })
  const [twins, setTwins] = useState({})

  async function load() {
    setErr('')
    try {
      const out = await api(`/orgs?limit=${limit}&offset=${offset}`)
      setOrgs(out.organisations); setTotal(out.total)
    } catch (ex) { setErr(ex.message) }
  }
  useEffect(() => { load() }, [limit, offset])

  async function createOrg(e) {
    e.preventDefault(); setErr('')
    try {
      await api('/orgs', {
        method: 'POST',
        body: {
          canonical_name: form.canonical_name,
          entity_type: form.entity_type,
          domains: form.domains ? form.domains.split(',').map((s) => s.trim()).filter(Boolean) : [],
          country: form.country || null,
        },
      })
      setShowForm(false)
      setForm({ canonical_name: '', entity_type: 'buyer', domains: '', country: '' })
      load()
    } catch (ex) { setErr(ex.message) }
  }

  async function openTwins(orgId) {
    if (twinOrg === orgId) { setTwinOrg(null); return }
    setTwinOrg(orgId)
    try {
      const out = await api(`/twins?org_id=${orgId}`)
      setTwins((m) => ({ ...m, [orgId]: out.twins }))
    } catch (ex) { setErr(ex.message) }
  }

  async function createTwin(e, orgId) {
    e.preventDefault(); setErr('')
    try {
      const capabilities = twinForm.capabilities
        ? twinForm.capabilities.split('\n').map((s) => s.trim()).filter(Boolean)
            .map((name) => ({ name, status: 'claimed' }))
        : []
      await api('/twins', {
        method: 'POST',
        body: {
          organisation_id: orgId,
          offering: twinForm.offering,
          version: { mandate: twinForm.mandate || null, capabilities, status: 'active' },
        },
      })
      setTwinForm({ offering: false, mandate: '', capabilities: '' })
      const out = await api(`/twins?org_id=${orgId}`)
      setTwins((m) => ({ ...m, [orgId]: out.twins }))
    } catch (ex) { setErr(ex.message) }
  }

  const visible = (orgs || []).filter((o) =>
    !q.trim() || o.canonical_name.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Companies</h1>
          <div className="sub">Every organisation you track — targets, providers, partners.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ width: 200 }} placeholder="Filter by name…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" onClick={() => setShowForm(!showForm)}>{showForm ? 'Close' : '+ Company'}</button>
        </div>
      </div>
      {err && <div className="error">{err}</div>}

      {showForm && (
        <div className="card">
          <h2>New company</h2>
          <form onSubmit={createOrg}>
            <div className="form-row">
              <div><label>Name</label>
                <input required value={form.canonical_name} onChange={(e) => setForm({ ...form, canonical_name: e.target.value })} placeholder="Exact legal or trading name" /></div>
              <div><label>Type</label>
                <select value={form.entity_type} onChange={(e) => setForm({ ...form, entity_type: e.target.value })}>
                  <option value="buyer">Buyer / target</option>
                  <option value="provider">Provider</option>
                  <option value="partner">Partner</option>
                  <option value="other">Other</option>
                </select></div>
              <div><label>Country</label>
                <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="United Arab Emirates" /></div>
            </div>
            <label>Domains (comma-separated)</label>
            <input value={form.domains} onChange={(e) => setForm({ ...form, domains: e.target.value })} placeholder="example.com, example.ae" />
            <div style={{ marginTop: 12 }}>
              <button className="btn">Create</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        {orgs === null ? (
          <div className="empty">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="empty">{q ? 'No matches.' : 'No companies yet — add one, or just type an idea on the left; the company is created for you.'}</div>
        ) : (
          <>
            <table className="rows">
              <thead>
                <tr><th>Company</th><th>Type</th><th>Country</th><th>Domains</th><th></th></tr>
              </thead>
              <tbody>
                {visible.map((o) => (
                  <React.Fragment key={o.id}>
                    <tr>
                      <td><strong>{o.canonical_name}</strong>{o.aliases?.length ? <div className="count">aka {o.aliases.join(', ')}</div> : null}</td>
                      <td>{o.entity_type}</td>
                      <td>{o.country || '—'}</td>
                      <td>{o.domains?.join(', ') || '—'}</td>
                      <td><button className="btn secondary small" onClick={() => openTwins(o.id)}>{twinOrg === o.id ? 'Hide twins' : 'Twins'}</button></td>
                    </tr>
                    {twinOrg === o.id && (
                      <tr>
                        <td colSpan={5} style={{ background: '#fbfbfe' }}>
                          <div className="drawer">
                            <strong style={{ fontSize: 13 }}>Twins for {o.canonical_name}</strong>
                            {(twins[o.id] || []).map((t) => (
                              <div key={t.id} style={{ marginTop: 8, fontSize: 13 }}>
                                {t.offering ? '★ Offering (seller) twin' : 'Target twin'} · owner #{t.owner_user_id?.slice(0, 8)}
                              </div>
                            ))}
                            {!(twins[o.id] || []).length && <div className="count">No twins yet.</div>}
                            <form onSubmit={(e) => createTwin(e, o.id)} style={{ marginTop: 10 }}>
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <input type="checkbox" style={{ width: 'auto' }} checked={twinForm.offering} onChange={(e) => setTwinForm({ ...twinForm, offering: e.target.checked })} />
                                This is OUR offering twin (seller profile)
                              </label>
                              <label>Mandate / objectives</label>
                              <textarea rows={2} value={twinForm.mandate} onChange={(e) => setTwinForm({ ...twinForm, mandate: e.target.value })} placeholder="e.g. Originate GPU compute demand from GCC AI companies" />
                              <label>Capabilities (one per line)</label>
                              <textarea rows={2} value={twinForm.capabilities} onChange={(e) => setTwinForm({ ...twinForm, capabilities: e.target.value })} placeholder={"GPU compute brokerage\nGCC market access"} />
                              <div style={{ marginTop: 10 }}>
                                <button className="btn small">Create twin (v1)</button>
                              </div>
                            </form>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            <div className="count" style={{ marginTop: 10 }}>
              Showing {visible.length} of {total}
              {offset > 0 && <> · <button className="btn secondary small" onClick={() => setOffset(Math.max(0, offset - limit))}>Prev</button></>}
              {offset + orgs.length < total && <> · <button className="btn secondary small" onClick={() => setOffset(offset + limit)}>Next</button></>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
