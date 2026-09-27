// client/src/api.js — thin fetch wrapper: bearer + tenant headers, error normal form.
const TOKEN_KEY = 'alleadz.token'

export function getToken() { return localStorage.getItem(TOKEN_KEY) }
export function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) }

export function getTenant() { return JSON.parse(localStorage.getItem('alleadz.tenant') || 'null') }
export function setTenant(t) { t ? localStorage.setItem('alleadz.tenant', JSON.stringify(t)) : localStorage.removeItem('alleadz.tenant') }

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  const tenant = getTenant()
  if (token) headers.Authorization = `Bearer ${token}`
  if (tenant?.id) headers['X-Tenant-Id'] = tenant.id
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Request failed (${res.status})`)
    err.status = res.status
    err.code = json?.error?.code
    throw err
  }
  return json
}
