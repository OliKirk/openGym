// Steps from Apple Health, through an iPhone Shortcut and the app's /api/steps (frontend/api/steps.js).
// (Not the Android Health Connect sync — that is lib/health-sync.js + lib/health-connect.js.)
// The phone makes a random sync code once; the shortcut sends today's steps with it, and the app
// fetches the days for that code and fills the daily steps task. Health is the phone's own count,
// so it wins over a smaller number typed by hand, but never lowers a bigger one.
import { countOn, dailyGoalsOf, setCount } from './daily.js'

const ENDPOINT = 'api/steps'
const ISO = /^\d{4}-\d{2}-\d{2}$/

/** A new random sync code (24 letters and digits). */
export function makeCode(rand = () => Math.random()) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = typeof crypto !== 'undefined' && crypto.getRandomValues && rand === Math.random
    ? Array.from(crypto.getRandomValues(new Uint8Array(24))) : Array.from({ length: 24 }, () => Math.floor(rand() * 256))
  return bytes.map(b => abc[b % abc.length]).join('')
}

export const healthCodeOf = S => (typeof S?.daily?.healthCode === 'string' ? S.daily.healthCode : null)

/** Sets or clears the code (inside a store update). */
export function setHealthCode(s, code) {
  if (!s.daily || typeof s.daily !== 'object') s.daily = { goals: null, log: {} }
  if (code) s.daily.healthCode = code
  else delete s.daily.healthCode
}

/** The address the shortcut calls; the shortcut adds the step count at the end. */
export const pushUrl = (origin, code) => `${String(origin).replace(/\/+$/, '')}/api/steps?code=${code}&steps=`

/** The steps goal: the one with id 'steps', else the first counted in steps. */
export const stepsGoalOf = S => dailyGoalsOf(S).find(g => g.id === 'steps') || dailyGoalsOf(S).find(g => g.unit === 'steps') || null

/** Server answer → { iso: steps } with only sane entries. */
export function parseHealthDays(data) {
  const out = {}
  const days = data?.days
  if (!days || typeof days !== 'object') return out
  for (const [k, v] of Object.entries(days)) {
    const n = Number(v)
    if (ISO.test(k) && Number.isFinite(n) && n >= 0 && n < 200000) out[k] = Math.round(n)
  }
  return out
}

/** Writes Health days into the steps task (inside a store update); returns how many days changed. */
export function applyHealthDays(s, days) {
  const goal = stepsGoalOf(s)
  if (!goal) return 0
  let changed = 0
  for (const [iso, n] of Object.entries(days)) {
    if (n > countOn(s, iso, goal.id)) { setCount(s, iso, goal.id, n); changed++ }
  }
  return changed
}

/** Fetches the days for a code. Throws an Error with code 'setup' when storage isn't connected. */
export async function fetchHealthDays(code, fetchFn = (...a) => fetch(...a)) {
  const res = await fetchFn(`${ENDPOINT}?code=${encodeURIComponent(code)}`, { headers: { Accept: 'application/json' }, cache: 'no-store' })
  if (res.status === 503) throw Object.assign(new Error('not set up'), { code: 'setup' })
  if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { code: 'failed' })
  return parseHealthDays(await res.json())
}
