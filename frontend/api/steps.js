// Vercel serverless function: steps from Apple Health into the app, by way of an iPhone Shortcut.
//
// A web app cannot read Apple Health, but the Shortcuts app can. The user's shortcut reads today's
// steps and calls
//   GET /api/steps?code=<the app's sync code>&steps=8234        → stores today's steps
// and the app, when it opens, asks
//   GET /api/steps?code=<the same code>                         → { days: { 'YYYY-MM-DD': steps } }
// The code is a long random string made on the phone (lib/health-sync.js); it is the only key, so
// nothing else about the person is stored. Kept in a private Vercel Blob store (BLOB_READ_WRITE_TOKEN,
// added when the store is connected to the project); the last 60 days are kept.

import { get, put } from '@vercel/blob'

const CODE = /^[A-Za-z0-9]{16,48}$/
const ISO = /^\d{4}-\d{2}-\d{2}$/
const KEEP_DAYS = 60

// "Today" where the user lives, not where the function runs (UTC).
const todayIn = (tz = 'Europe/Copenhagen') => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

// "8.234", "8,234" and "8234,0" all mean 8234 steps: Danish Shortcuts write numbers with separators.
// A Health sample can arrive with its unit ("8.234 skridt", "8234 count"): the leading number counts.
export function parseSteps(v) {
  const m = /\d[\d.,\s]*/.exec(String(v ?? ''))
  const s = m ? m[0].replace(/\s/g, '').replace(/[.,]$/, '') : ''
  if (!s) return null
  const whole = /^\d{1,3}([.,]\d{3})+$/.test(s) ? s.replace(/[.,]/g, '') : s.replace(',', '.')
  const n = Math.round(parseFloat(whole))
  return Number.isFinite(n) && n >= 0 && n < 200000 ? n : null
}

async function load(code) {
  const r = await get(`health/${code}.json`, { access: 'private', useCache: false }).catch(() => null)
  if (!r?.stream) return { days: {} }
  try {
    const data = await new Response(r.stream).json()
    return data && typeof data.days === 'object' ? data : { days: {} }
  } catch { return { days: {} } }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (!process.env.BLOB_READ_WRITE_TOKEN) { res.status(503).json({ error: 'storage not connected' }); return }
  const q = { ...(req.query || {}), ...(req.body && typeof req.body === 'object' ? req.body : {}) }
  const code = String(q.code || '')
  if (!CODE.test(code)) { res.status(400).json({ error: 'bad code' }); return }

  const data = await load(code)
  if (q.steps === undefined) { res.status(200).json({ days: data.days, updated: data.updated || null }); return }

  const steps = parseSteps(q.steps)
  if (steps == null) { res.status(400).send('Kunne ikke læse antal skridt: ' + String(q.steps).slice(0, 40)); return }
  const date = ISO.test(String(q.date || '')) ? String(q.date) : todayIn()
  const days = { ...data.days, [date]: steps }
  const keep = Object.keys(days).sort().slice(-KEEP_DAYS)
  const next = { days: Object.fromEntries(keep.map(k => [k, days[k]])), updated: new Date().toISOString() }
  await put(`health/${code}.json`, JSON.stringify(next), {
    access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60,
  })
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.status(200).send(`Gemt i openGym: ${steps.toLocaleString('da-DK')} skridt (${date})`)
}
