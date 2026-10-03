// server/src/lib/verticals.js — curated vertical presets (blueprint-audit fix 4).
// Each preset seeds the mandate twin (the "mandate twin" law: what the desk
// buys, where, and what the desk NEVER bothers with) and the qualification
// gate. Deterministic data only; the scoring rubric itself is unchanged.

export const LANES = Object.freeze({
  'bank-frick': {
    label: 'Bank Frick — New Ventures client acquisition',
    twin: {
      organisation: 'Bank Frick (our desk)',
      offering: true,
      version: {
        mandate: 'Onboard professional market participants with digital-asset '
          + 'exposure: crypto exchanges, brokers and OTC desks; prop traders and '
          + 'market makers; digital-asset funds; foundations and DAO treasuries; '
          + 'FX, payments and EMI/PI firms; tokenized-RWA issuers; staking and '
          + 'custody infrastructure providers.',
        permitted_markets: [], // open — gate is the exclusion list + sanctions
        excluded_markets: Object.freeze([
          // sanctions (hard failures, never onboardable)
          'Belarus', 'Cuba', 'Iran', 'North Korea', 'Russia', 'Syria',
          'Crimea', 'Donetsk', 'Luhansk', 'Venezuela', 'Nicaragua',
          // Latin America (harder onboarding — excluded per desk decision)
          'Argentina', 'Bolivia', 'Brazil', 'Chile', 'Colombia', 'Costa Rica',
          'Ecuador', 'El Salvador', 'Guatemala', 'Honduras', 'Mexico',
          'Panama', 'Paraguay', 'Peru', 'Uruguay',
        ]),
        objectives: [
          'Identify entities needing regulated banking/custody relationships',
          'Spot banking-partner gaps via compliance hiring and licensing moves',
          'Route qualified leads to the New Ventures desk (Nikola receives)',
        ],
        capabilities: [
          { name: 'Blockchain Banking (trading + custody)', status: 'reviewed' },
          { name: 'Sponsored Access (RULEMATCH)', status: 'reviewed' },
          { name: 'Fund Solutions', status: 'reviewed' },
          { name: 'Institutional treasury + Staking', status: 'reviewed' },
          { name: 'VBANs / xPULSE 23/7 payments', status: 'reviewed' },
        ],
        constraints: Object.freeze({
          min_expected_deposit_usd: 1_000_000,
          client_classes: [
            'crypto_exchange_broker_otc', 'prop_trader_market_maker',
            'digital_asset_fund', 'foundation_dao_treasury',
            'fx_payments_emi_pi', 'tokenized_rwa_issuer', 'staking_infra',
          ],
          excluded_segments: ['retail', 'consumer_apps', 'sub_1m_deposit'],
          receiving_desk: 'new_ventures',
        }),
      },
    },
    cueLexicon: {
      banking_partner_gap: [
        'bank account closed', 'unbanked', 'banking rejected', 'debanked',
        'account freeze', 'offboarding', 'lost our banking partner',
        'no banking access', 'firewalls between us and banks',
      ],
      compliance_hiring: [
        'mlro', 'money laundering reporting officer', 'head of compliance',
        'compliance officer (digital assets)', 'bureau de change licence',
        'compliance analyst (crypto)', 'regulatory affairs (digital assets)',
      ],
      licensing_and_registries: [
        'CASP authorisation', 'MiCA licence', 'VASP registration',
        'FMA Liechtenstein', 'FINMA', 'BaFin', 'FX licence',
        'EMI licence', 'PI licence', 'payment institution authorisation',
      ],
      scale_and_treasury_events: [
        'series a', 'series b', 'growth round', 'treasury allocation',
        'token unlock', 'foundation launch', 'dao treasury', 'otc desk launch',
        'market making desk', 'stablecoin settlement', 'corporate treasury bitcoin',
      ],
    },
    exportTemplate: 'rm_call_sheet',
    template: {
      title: 'RM call sheet — {target_name}',
      fields: [
        'entity + class + lifecycle stage (licensed / pre-license / scaling)',
        'trigger event + source URL (cite-or-hypothesis law applies)',
        'why now: banking-partner gap evidence (cues hit)',
        'product hook: which Frick service fits and why',
        'qualification: expected deposit ≥ USD 1,000,000 (claim + evidence)',
        'suggested opener (the RM speaks; this sheet does not)',
      ],
    },
    gate: {
      min_expected_deposit_usd: 1_000_000,
      sanctioned_or_latam: 'fail',
    },
  },

  'own-products': {
    label: "Nikola's own products — paying-customer acquisition",
    twin: {
      organisation: 'Stojanow product portfolio',
      offering: true,
      version: {
        mandate: 'Find paying customers for live products: Nybls (learning '
          + 'sessions from video/podcasts/articles/PDFs), Sovereign Grid (B2B '
          + 'GPU compute marketplace), GulfWatch (MENA geopolitical '
          + 'intelligence), KONTOR (agent-to-agent trading venue).',
        permitted_markets: [],
        excluded_markets: [],
        objectives: [
          'Convert public pain complaints into founder outreach (human sends)',
          'Route buyers to live product surfaces (nikolastojanow.com)',
        ],
        capabilities: [
          { name: 'Nybls learning sessions', status: 'evidenced' },
          { name: 'Sovereign Grid GPU marketplace', status: 'evidenced' },
          { name: 'GulfWatch MENA intelligence', status: 'claimed' },
          { name: 'KONTOR A2A venue', status: 'evidenced' },
        ],
        constraints: Object.freeze({
          product_map: {
            nybls: ['course creators', 'cohort teachers', 'corporate L&D', 'podcasters'],
            sovereign_grid: ['ai startups', 'ml researchers', 'datacenter supply side'],
            gulfwatch: ['institutional desks', 'analysts with MENA exposure'],
            kontor: ['ai agent developers', 'trading bot builders'],
          },
        }),
      },
    },
    cueLexicon: {
      nybls: [
        'turn this into a course', 'summarize this podcast', 'study from video',
        'quiz my team', 'learning fatigue', 'too long; did not watch',
        'course from youtube', 'onboarding material video',
      ],
      sovereign_grid: [
        'gpu shortage', 'gpu costs', 'h100 price', 'a100 rental',
        'vast.ai down', 'gpu credits', 'inference costs', 'training run budget',
      ],
      gulfwatch: [
        'mena escalation', 'gulf security risk', 'strait of hormuz',
        'regional intelligence gap', 'early warning mena',
      ],
      kontor: [
        'agent payments', 'a2a settlement', 'agent-to-agent trust',
        'bot counterparty risk', 'agent wallet',
      ],
    },
    exportTemplate: 'founder_outreach_draft',
    template: {
      title: 'Founder outreach — {product} → {target_name}',
      fields: [
        'their pain, in their words (quote + source URL)',
        'the one live product that answers it (+ link)',
        'proof line: live product, automated checks, no mockups',
        'single ask (15-min call / trial link)',
        'sent by Nikola personally — system never sends',
      ],
    },
    gate: { min_expected_deposit_usd: null },
  },
})

export function listLanes() {
  return Object.entries(LANES).map(([key, v]) => ({
    key, label: v.label, exportTemplate: v.exportTemplate,
    template: v.template, gate: v.gate,
  }))
}

export function getPreset(key) {
  return LANES[key] ?? null
}

/**
 * Identify the active lane from a mandate-twin mandate text (deterministic;
 * sentinel phrases come from the curated presets themselves).
 */
export function laneKeyOf(mandate) {
  if (!mandate) return null
  const m = String(mandate).toLowerCase()
  if (m.includes('professional market participants') || m.includes('banking/custody relationships')) {
    return 'bank-frick'
  }
  if (m.includes('paying customers for live products')) return 'own-products'
  return null
}

/**
 * Deterministic cue extraction: count lexicon hits in fetched text.
 * Returns [{category, cue}] — caller stores as evidence metadata.
 */
export function extractCues(presetKey, text) {
  const preset = LANES[presetKey]
  if (!preset || !text) return []
  const hay = String(text).toLowerCase()
  const hits = []
  for (const [category, cues] of Object.entries(preset.cueLexicon)) {
    for (const cue of cues) {
      if (hay.includes(cue)) hits.push({ category, cue })
    }
  }
  return hits
}

/**
 * Qualification gate — deterministic hard check, evaluated by the rubric.
 * Returns {name, verdict, detail}: fail if sanctions/LATAM match, or if the
 * lane demands a minimum deposit and none/less is on record.
 */
export function runLaneGate(presetKey, targetClaims = {}) {
  const preset = LANES[presetKey]
  if (!preset) return { name: 'lane_gate', verdict: 'unknown', detail: 'no preset' }
  const excluded = preset.twin.version.excluded_markets
    .map((m) => m.toLowerCase())
  const country = String(targetClaims.country ?? '').toLowerCase()
  if (country && excluded.some((m) => country.includes(m))) {
    return { name: 'lane_gate', verdict: 'fail',
      detail: `target country falls in the lane's excluded list (sanctions/LATAM)` }
  }
  const min = preset.gate.min_expected_deposit_usd
  if (min != null) {
    const dep = targetClaims.expected_deposit_usd
    if (dep == null) {
      return { name: 'lane_gate', verdict: 'unknown',
        detail: `no expected-deposit claim (lane requires ≥ USD ${min.toLocaleString('en-US')})` }
    }
    if (Number(dep) < min) {
      return { name: 'lane_gate', verdict: 'fail',
        detail: `expected deposit USD ${Number(dep).toLocaleString('en-US')} below USD ${min.toLocaleString('en-US')} floor` }
    }
  }
  return { name: 'lane_gate', verdict: 'pass', detail: 'within lane constraints' }
}
