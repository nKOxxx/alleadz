// client/src/client.test.jsx — P1 client gates (A02, A16, evidence UX)
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'styles.css'), 'utf8')

// A02 (client half): token + tenant persist across reload.
describe('auth persistence', () => {
  it('token/tenant round-trip through localStorage helpers', async () => {
    const { setToken, getToken, setTenant, getTenant } = await import('./api.js')
    setToken('tok_abc')
    setTenant({ id: '11111111-1111-1111-1111-111111111111', name: 'WS' })
    expect(getToken()).toBe('tok_abc')
    expect(getTenant().name).toBe('WS')
    setToken(null); setTenant(null)
    expect(getToken()).toBe(null)
    expect(getTenant()).toBe(null)
  })
})

// Evidence chips must be visually distinct per class (spec §8 law, visible in UI)
describe('evidence chip styling', () => {
  it('defines distinct chip classes for sourced_fact / user_claim / inference', async () => {
    for (const cls of ['sourced_fact', 'user_claim', 'inference']) {
      expect(CSS).toMatch(new RegExp(`\\.chip\\.${cls}`))
    }
  })
})

// A16 (client half): mobile breakpoints exist and restructure the shell.
describe('mobile law (A16)', () => {
  it('has a <=720px breakpoint that stacks the shell and hides the side footer', async () => {
    expect(CSS).toMatch(/@media \(max-width: 720px\)/)
    const block = CSS.split('@media (max-width: 720px)')[1] || ''
    expect(block).toMatch(/grid-template-columns:\s*1fr/) // shell stacks
    expect(block).toMatch(/\.side-foot[^{]*\{\s*display:\s*none/) // footer hidden
  })
})
