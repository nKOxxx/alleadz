// prod smoke + demo seed (synthetic data only; deleted after run)
import { registerUser, api } from './test/helpers.js'

const base = 'https://alleadz.onrender.com'
const email = `demo-${Math.random().toString(36).slice(2, 8)}@demo.alleadz.test`
const password = 'Demo-' + Math.random().toString(36).slice(2, 12) + '!'

const A = await registerUser(base, email, 'Alleadz Demo')
console.log('1 register:', A.tenantId ? 'ok' : 'FAIL')

const org = await api(base, { method: 'POST', path: '/orgs', token: A.token, tenantId: A.tenantId,
  body: { canonical_name: 'Demo Gulf Industries (synthetic)', entity_type: 'buyer', country: 'United Arab Emirates' } })
console.log('2 org:', org.status)

const person = await api(base, { method: 'POST', path: '/people', token: A.token, tenantId: A.tenantId,
  body: { full_name: 'Demo Contact Person', organisation_id: org.json.id, role_title: 'VP Technology', seniority: 'vp' } })
console.log('3 person:', person.status)

const contact = await api(base, { method: 'POST', path: '/contacts', token: A.token, tenantId: A.tenantId,
  body: { person_id: person.json.id, kind: 'email', value: 'contact@demogulf.example',
    email_class: 'company_published', deliverability: 'untested' } })
console.log('4 contact:', contact.status)

const offerOrg = await api(base, { method: 'POST', path: '/orgs', token: A.token, tenantId: A.tenantId,
  body: { canonical_name: 'Demo Capacity Partners (synthetic)', entity_type: 'provider' } })
const twin = await api(base, { method: 'POST', path: '/twins', token: A.token, tenantId: A.tenantId,
  body: { organisation_id: offerOrg.json.id, offering: true,
    version: { mandate: 'originate GPU compute and data centre capacity deals', permitted_markets: [],
      excluded_markets: [], capabilities: [{ name: 'GPU compute brokerage', status: 'reviewed' }], status: 'active' } } })
const opp = await api(base, { method: 'POST', path: '/opportunities', token: A.token, tenantId: A.tenantId,
  body: { offering_twin_id: twin.json.twin?.id || twin.json.id, target_org_id: org.json.id, sector_type: 'gpu_rental' } })
console.log('5 opportunity:', opp.status)

const plan = await api(base, { method: 'POST', path: '/plans', token: A.token, tenantId: A.tenantId,
  body: { opportunity_id: opp.json.opportunity.id, title: 'Demo intro sequence' } })
console.log('6 plan:', plan.status)

console.log('SMOKE_OK')
process.exit(0)
