// Daily tasks: small fixed targets for every day — 100 push-ups, 100 sit-ups, 10,000 steps —
// counted up through the day and ticked off when the target is reached.
//
// Kept on S.daily:
//   goals  [{ id, name, target, unit, step }] | null   (null = the default list below)
//   log    { 'YYYY-MM-DD': { [goalId]: count } }
// `step` is the size of the quick-add button (+10 reps, +1,000 steps). The functions that change
// state take the draft `s` inside a store update, like the rest of lib/.

export const DEFAULT_DAILY = [
  { id: 'pushups', name: 'Armbøjninger', target: 100, unit: 'reps', step: 10 },
  { id: 'situps', name: 'Mavebøjninger', target: 100, unit: 'reps', step: 10 },
  { id: 'steps', name: 'Skridt', target: 10000, unit: 'steps', step: 1000 },
]

const UNITS = ['reps', 'steps', 'min', 'km']

// "8.234" and "10,000" are thousands (Danish and English), not decimals: nobody does 8.2 steps.
const int = v => {
  const str = typeof v === 'string' ? v.trim() : null
  const x = str == null ? Number(v)
    : /^\d{1,3}([.,]\d{3})+$/.test(str) ? Number(str.replace(/[.,]/g, ''))
      : parseFloat(str.replace(',', '.'))
  return Number.isFinite(x) ? Math.round(x) : 0
}

export function dailyOf(S) {
  const d = S?.daily
  return {
    goals: Array.isArray(d?.goals) ? d.goals : null,
    log: d?.log && typeof d.log === 'object' ? d.log : {},
  }
}

function ensureDaily(s) {
  if (!s.daily || typeof s.daily !== 'object') s.daily = { goals: null, log: {} }
  if (!s.daily.log || typeof s.daily.log !== 'object') s.daily.log = {}
  if (!('goals' in s.daily)) s.daily.goals = null
  return s.daily
}

export const dailyGoalsOf = S => dailyOf(S).goals || DEFAULT_DAILY

/** Count so far for one goal on one day. */
export const countOn = (S, iso, id) => Math.max(0, int(dailyOf(S).log[iso]?.[id]))

/** Each goal with the day's count, its share (0–1) and whether it is reached. */
export function progressOn(S, iso) {
  return dailyGoalsOf(S).map(g => {
    const count = countOn(S, iso, g.id)
    return { ...g, count, share: g.target > 0 ? Math.min(1, count / g.target) : 0, complete: g.target > 0 && count >= g.target }
  })
}

export const allDoneOn = (S, iso) => {
  const p = progressOn(S, iso)
  return p.length > 0 && p.every(g => g.complete)
}

/** Sets a goal's count for a day (inside a store update); 0 removes it, an empty day is dropped. */
export function setCount(s, iso, id, value) {
  const d = ensureDaily(s)
  const v = Math.max(0, Math.min(1_000_000, int(value)))
  const day = { ...(d.log[iso] || {}) }
  if (v) day[id] = v
  else delete day[id]
  if (Object.keys(day).length) d.log[iso] = day
  else delete d.log[iso]
}

/** Adds to (or, with a negative delta, takes from) a goal's count for a day. */
export function addCount(s, iso, id, delta) {
  setCount(s, iso, id, countOn(s, iso, id) + int(delta))
}

/** Fills a goal up to its target for the day ("done"). */
export function completeGoal(s, iso, id) {
  const g = dailyGoalsOf(s).find(x => x.id === id)
  if (g) setCount(s, iso, id, Math.max(countOn(s, iso, id), g.target))
}

const prevISO = iso => {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** Days in a row with every task done, ending today (or yesterday, while today is still open). */
export function dailyStreak(S, today) {
  let iso = allDoneOn(S, today) ? today : prevISO(today)
  let n = 0
  while (allDoneOn(S, iso) && n < 3650) { n++; iso = prevISO(iso) }
  return n
}

/** Replaces the list (inside a store update): empty names dropped, targets kept positive. */
export function setDailyGoals(s, list, now = Date.now()) {
  const d = ensureDaily(s)
  const seen = new Set()
  d.goals = (list || [])
    .map((g, i) => {
      const name = String(g?.name || '').trim().slice(0, 60)
      if (!name) return null
      let id = g.id && !seen.has(g.id) ? String(g.id) : now.toString(36) + i
      seen.add(id)
      const unit = UNITS.includes(g.unit) ? g.unit : 'reps'
      const target = Math.max(1, int(g.target) || 1)
      const step = Math.max(1, int(g.step) || (unit === 'steps' ? 1000 : 10))
      return { id, name, target, unit, step }
    })
    .filter(Boolean)
}
