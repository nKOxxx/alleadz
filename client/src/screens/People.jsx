import React, { useEffect, useState } from 'react'
import { api } from '../api.js'

// People & contacts = CRM people object. Inline create + contact points,
// with the email-class law surfaced (a published contact is what makes
// approval possible later).
const EMAIL_CLASSES = [
  ['person_published', 'person published'],
  ['company_published', 'company published'],
  ['third_party_reported', 'third-party reported'],
  ['functional_inbox', 'functional inbox'],
  ['non_commercial_inbox', 'non-commercial inbox'],
  ['not_found', 'not found'],
]

export default function People() {
  const [people, setPeople] = useState(null)
  const [contacts, setContacts] = useState([])
  const [orgs, setOrgs] = useState([])
  const [err, setErr] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [q, setQ] = useState('')

  const [form, setForm] = useState({ full_name: '', organisation_id: '', role_title: '', seniority: 'unknown', email: '', email_class: 'company_published' })

  async function load() {
    setErr('')
    try {
      const [p, c, o] = await Promise.all([api('/people'), api('/contacts'), api('/orgs?limit=200')])
      setPeople(p.people || []); setContacts(c.contacts || []); setOrgs(o.organisations || [])
    } catch (ex) { setErr(ex.message) }
  }
  useEffect(() => { load() }, [])

  async function create(e) {
    e.preventDefault(); setErr('')
    try {
      const out = await api('/people', { method: 'POST', body: {
        full_name: form.full_name,
        organisation_id: form.organisation_id || null,
        role_title: form.role_title || null,
        seniority: form.seniority,
      } })
      if (form.email.trim()) {
        await api('/contacts', { method: 'POST', body: {
          person_id: out.id, kind: 'email', value: form.email.trim(),
          email_class: form.email_class, deliverability: 'untested',
        } })
      }
      setShowForm(false)
      setForm({ full_name: '', organisation_id: '', role_title: '', seniority: 'unknown', email: '', email_class: 'company_published' })
      load()
    } catch (ex) { setErr(ex.message) }
  }

  const orgName = (id) => (orgs.find((o) => o.id === id) || {}).canonical_name || '—'
  const emailFor = (pid) => (contacts.find((c) => c.person_id === pid && c.kind === 'email') || {})
  const visible = (people || []).filter((p) =>
    !q.trim() || p.full_name.toLowerCase().includes(q.trim().toLowerCase()) ||
    orgName(p.organisation_id).toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>People &amp; contacts</h1>
          <div className="sub">Decision owners and how to reach them. Outreach can only bind to published contacts.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ width: 200 }} placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" onClick={() => setShowForm(!showForm)}>{showForm ? 'Close' : '+ Person'}</button>
        </div>
      </div>
      {err && <div className="error">{err}</div>}

      {showForm && (
        <div className="card">
          <h2>New person</h2>
          <form onSubmit={create}>
            <div className="form-row">
              <div><label>Full name</label>
                <input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Layla Haddad" /></div>
              <div><label>Company</label>
                <select value={form.organisation_id} onChange={(e) => setForm({ ...form, organisation_id: e.target.value })}>
                  <option value="">— none —</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.canonical_name}</option>)}
                </select></div>
              <div><label>Role title</label>
                <input value={form.role_title} onChange={(e) => setForm({ ...form, role_title: e.target.value })} placeholder="VP Infrastructure" /></div>
              <div><label>Seniority</label>
                <select value={form.seniority} onChange={(e) => setForm({ ...form, seniority: e.target.value })}>
                  {['unknown', 'individual', 'manager', 'director', 'vp', 'c_level', 'board'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select></div>
            </div>
            <div className="form-row">
              <div><label>Email (optional)</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" /></div>
              <div><label>Email class</label>
                <select value={form.email_class} onChange={(e) => setForm({ ...form, email_class: e.target.value })}>
                  {EMAIL_CLASSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></div>
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="btn">Create</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        {people === null ? (
          <div className="empty">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="empty">{q ? 'No matches.' : 'No people yet. Add the decision owner when you capture an opportunity.'}</div>
        ) : (
          <table className="rows">
            <thead><tr><th>Name</th><th>Company</th><th>Role</th><th>Email</th><th>Class</th></tr></thead>
            <tbody>
              {visible.map((p) => {
                const c = emailFor(p.id)
                return (
                  <tr key={p.id}>
                    <td><strong>{p.full_name}</strong></td>
                    <td>{orgName(p.organisation_id)}</td>
                    <td>{p.role_title || '—'}</td>
                    <td>{c.value || <span className="count">none</span>}</td>
                    <td>{c.email_class ? <span className={`chip ${c.email_class === 'person_published' || c.email_class === 'company_published' ? 'sourced_fact' : 'unknown'}`}>{c.email_class.replace(/_/g, ' ')}</span> : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
