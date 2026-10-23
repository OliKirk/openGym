// Food & macro tracking — the pure half. Everything that decides a number (a daily goal, a day's
// totals, what 150 g of something comes to) lives here with a test beside it; the screen in
// views/Nutrition.jsx only reads and writes S.nutrition through these helpers.
//
// Shape kept in the profile (S.nutrition):
//   goals   { kcal, p, c, f }                     grams for p/c/f, null until set
//   profile { sex, age, height, weight, activity, goal }   what the goals were calculated from
//   log     { [iso]: [entry] }                    what was eaten, one list per day
//   foods   [food]                                saved and recently used foods, newest first
//
//   drinks  { [iso]: [drink] }                    what was drunk, one list per day
//   waterGoal  ml per day, null until set (DEFAULT_WATER_ML is shown meanwhile)
//
//   food   { id, name, brand, code, per100: { kcal, p, c, f }, serving, t }   serving = grams in one portion
//   entry  { id, meal, name, brand, foodId, grams, per100, t }               a food in an amount
//          { id, meal, name, quick: { kcal, p, c, f }, t }                     a quick add: just numbers

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks']
export const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks' }

export const ACTIVITY = [
  { value: 1.2, label: 'Little or no exercise' },
  { value: 1.375, label: 'Light (1–3 days a week)' },
  { value: 1.55, label: 'Moderate (3–5 days a week)' },
  { value: 1.725, label: 'Very active (6–7 days a week)' },
  { value: 1.9, label: 'Athlete (2 sessions a day)' },
]

export const GOALS = [
  { value: 'cut', label: 'Lose fat', kcal: -400 },
  { value: 'maintain', label: 'Maintain', kcal: 0 },
  { value: 'bulk', label: 'Build muscle', kcal: 250 },
]

const MAX_FOODS = 300
const ZERO = Object.freeze({ kcal: 0, p: 0, c: 0, f: 0 })

const num = v => {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}
const round1 = n => Math.round(n * 10) / 10

/** A clean { kcal, p, c, f } from anything shaped roughly like one: missing or bad values are 0. */
export function macros(m) {
  return { kcal: num(m?.kcal), p: num(m?.p), c: num(m?.c), f: num(m?.f) }
}

export function emptyNutrition() {
  return { goals: null, profile: null, log: {}, foods: [], drinks: {}, waterGoal: null }
}

/** The nutrition block of a profile, always in its full shape — older profiles have none. */
export function nutritionOf(S) {
  const n = S?.nutrition
  if (!n || typeof n !== 'object') return emptyNutrition()
  return {
    goals: n.goals || null,
    profile: n.profile || null,
    log: n.log && typeof n.log === 'object' ? n.log : {},
    foods: Array.isArray(n.foods) ? n.foods : [],
    drinks: n.drinks && typeof n.drinks === 'object' ? n.drinks : {},
    waterGoal: num(n.waterGoal) || null,
  }
}

/** Makes sure S.nutrition exists in its full shape; call inside a store update before writing. */
export function ensureNutrition(s) {
  s.nutrition = nutritionOf(s)
  return s.nutrition
}

/* ------------------------------------------------------------------ goals -- */

/** Resting energy, Mifflin–St Jeor. kg, cm, years. */
export function bmr({ sex, weight, height, age }) {
  const w = num(weight), h = num(height), a = num(age)
  if (!w || !h || !a) return 0
  return 10 * w + 6.25 * h - 5 * a + (sex === 'female' ? -161 : 5)
}

/**
 * Daily goals from a profile. Protein is set for someone who trains hard (2 g per kg), fat at
 * 0.9 g per kg but never under a quarter of the energy, and carbohydrate takes what is left —
 * the fuel for training and for a sport like badminton. Returns null when the profile is
 * incomplete.
 */
export function calcGoals(profile) {
  const base = bmr(profile || {})
  if (!base) return null
  const w = num(profile.weight)
  const activity = num(profile.activity) || 1.55
  const adjust = (GOALS.find(g => g.value === profile.goal) || GOALS[1]).kcal
  const kcal = Math.round((base * activity + adjust) / 10) * 10
  const p = Math.round(w * 2)
  const f = Math.round(Math.max(w * 0.9, (kcal * 0.25) / 9))
  const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4))
  return { kcal, p, c, f }
}

/** Energy that a set of macro grams adds up to — used to show whether hand-set goals agree. */
export const kcalFromMacros = m => Math.round(num(m?.p) * 4 + num(m?.c) * 4 + num(m?.f) * 9)

/** The newest logged body weight in kg, or null. */
export function latestWeightKg(S) {
  const list = Array.isArray(S?.bodyweight) ? S.bodyweight : []
  const last = [...list].filter(b => num(b?.w)).sort((a, b) => (a.d < b.d ? -1 : 1)).at(-1)
  if (!last) return null
  return S.unit === 'lb' ? round1(last.w * 0.45359237) : last.w
}

/* ---------------------------------------------------------------- amounts -- */

/** What `grams` of a food with these per-100 g values comes to. */
export function scale(per100, grams) {
  const g = num(grams), m = macros(per100)
  const k = g / 100
  return { kcal: Math.round(m.kcal * k), p: round1(m.p * k), c: round1(m.c * k), f: round1(m.f * k) }
}

/** An entry's own totals: a quick add is its numbers, a food is its amount. */
export function entryTotals(entry) {
  if (!entry) return { ...ZERO }
  if (entry.quick) {
    const q = macros(entry.quick)
    return { kcal: Math.round(q.kcal), p: round1(q.p), c: round1(q.c), f: round1(q.f) }
  }
  return scale(entry.per100, entry.grams)
}

export function sumTotals(list) {
  const out = { kcal: 0, p: 0, c: 0, f: 0 }
  for (const e of list || []) {
    const t = entryTotals(e)
    out.kcal += t.kcal; out.p += t.p; out.c += t.c; out.f += t.f
  }
  return { kcal: Math.round(out.kcal), p: round1(out.p), c: round1(out.c), f: round1(out.f) }
}

export const dayEntries = (S, iso) => nutritionOf(S).log[iso] || []
/** Everything eaten and drunk on a day: drinks with energy (milk, juice…) count like food. */
export const dayTotals = (S, iso) => addTotals(sumTotals(dayEntries(S, iso)), drinkTotals(dayDrinks(S, iso)))

function addTotals(a, b) {
  return { kcal: Math.round(a.kcal + b.kcal), p: round1(a.p + b.p), c: round1(a.c + b.c), f: round1(a.f + b.f) }
}
export const mealEntries = (S, iso, meal) => dayEntries(S, iso).filter(e => (e.meal || 'snacks') === meal)

/** Progress against a goal, 0…1 (capped), and what is left (negative = over). */
export function progress(eaten, goal) {
  const g = num(goal)
  if (!g) return { pct: 0, left: null }
  return { pct: Math.min(1, num(eaten) / g), left: Math.round((g - (Number(eaten) || 0)) * 10) / 10 }
}

/** The meal a new entry lands in by default, from the time of day. */
export function mealForTime(date = new Date()) {
  const h = date.getHours()
  if (h < 10) return 'breakfast'
  if (h < 14) return 'lunch'
  if (h >= 17 && h < 21) return 'dinner'
  return 'snacks'
}

/** ISO date `n` days from `iso`. */
export function shiftDay(iso, n) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

/** Average daily totals over the `days` days ending on `iso`, counting only days with food logged. */
export function averageTotals(S, iso, days = 7) {
  const n = nutritionOf(S)
  let count = 0
  const sum = { kcal: 0, p: 0, c: 0, f: 0 }
  for (let i = 0; i < days; i++) {
    const d = shiftDay(iso, -i)
    const list = n.log[d]
    if (!list || !list.length) continue
    const t = dayTotals(S, d)
    count++
    sum.kcal += t.kcal; sum.p += t.p; sum.c += t.c; sum.f += t.f
  }
  if (!count) return null
  return { days: count, kcal: Math.round(sum.kcal / count), p: Math.round(sum.p / count), c: Math.round(sum.c / count), f: Math.round(sum.f / count) }
}

/* ------------------------------------------------------------------ foods -- */

const key = s => String(s || '').trim().toLowerCase()

/**
 * Adds or refreshes a food in the saved list (inside a store update). A food with the same
 * barcode, or else the same name and brand, is the same food: it moves to the front with the
 * newer values. Returns the stored food. The list is capped so it never grows without bound.
 */
export function rememberFood(s, food, now = Date.now()) {
  const n = ensureNutrition(s)
  const clean = {
    id: food.id || now.toString(36) + Math.random().toString(36).slice(2, 7),
    name: String(food.name || '').trim().slice(0, 120) || 'Food',
    brand: String(food.brand || '').trim().slice(0, 80),
    code: food.code ? String(food.code) : '',
    per100: macros(food.per100),
    serving: num(food.serving) || null,
    t: now,
  }
  const same = n.foods.find(f => (clean.code && f.code === clean.code) || (key(f.name) === key(clean.name) && key(f.brand) === key(clean.brand)))
  if (same) clean.id = same.id
  if (same?.fav) clean.fav = true
  n.foods = [clean, ...n.foods.filter(f => f.id !== clean.id)].slice(0, MAX_FOODS)
  return clean
}

/** Saved foods matching a search, best match first (name starts with the query, then contains it). */
export function filterFoods(foods, q) {
  const k = key(q)
  if (!k) return foods
  const words = k.split(/\s+/)
  const hit = f => { const s = key(f.name + ' ' + f.brand); return words.every(w => s.includes(w)) }
  return foods.filter(hit).sort((a, b) => (key(b.name).startsWith(k) ? 1 : 0) - (key(a.name).startsWith(k) ? 1 : 0))
}

/** A new entry for a food in an amount. */
export function foodEntry(food, grams, meal, now = Date.now()) {
  return {
    id: now.toString(36) + Math.random().toString(36).slice(2, 7),
    meal: MEALS.includes(meal) ? meal : 'snacks',
    name: food.name, brand: food.brand || '', foodId: food.id || null,
    grams: Math.round(num(grams) * 10) / 10, per100: macros(food.per100), t: now,
  }
}

/** A new quick-add entry: a name (optional) and the numbers. */
export function quickEntry(name, values, meal, now = Date.now()) {
  return {
    id: now.toString(36) + Math.random().toString(36).slice(2, 7),
    meal: MEALS.includes(meal) ? meal : 'snacks',
    name: String(name || '').trim().slice(0, 120) || 'Quick add',
    quick: macros(values), t: now,
  }
}

/** Adds an entry to a day (inside a store update). */
export function addEntry(s, iso, entry) {
  const n = ensureNutrition(s)
  n.log[iso] = [...(n.log[iso] || []), entry]
}

/** Changes an entry in place (inside a store update); an empty day is removed. */
export function updateEntry(s, iso, id, patch) {
  const n = ensureNutrition(s)
  n.log[iso] = (n.log[iso] || []).map(e => (e.id === id ? { ...e, ...patch, t: Date.now() } : e))
}

export function removeEntry(s, iso, id) {
  const n = ensureNutrition(s)
  const rest = (n.log[iso] || []).filter(e => e.id !== id)
  if (rest.length) n.log[iso] = rest
  else delete n.log[iso]
}

/* ----------------------------------------------------------------- drinks -- */

// Values per 100 ml. Water, coffee and tea count as fluid only; the rest also count as food.
// Numbers are typical Danish products (letmælk, appelsinjuice, sodavand med sukker…).
export const DRINKS = [
  { id: 'water', label: 'Water', per100: { kcal: 0, p: 0, c: 0, f: 0 } },
  { id: 'coffee', label: 'Coffee', per100: { kcal: 2, p: 0.1, c: 0, f: 0 } },
  { id: 'tea', label: 'Tea', per100: { kcal: 1, p: 0, c: 0.2, f: 0 } },
  { id: 'milk', label: 'Milk', per100: { kcal: 46, p: 3.5, c: 4.7, f: 1.5 } },
  { id: 'juice', label: 'Juice', per100: { kcal: 45, p: 0.7, c: 10, f: 0.1 } },
  { id: 'soda', label: 'Soda', per100: { kcal: 42, p: 0, c: 10.6, f: 0 } },
  { id: 'zero', label: 'Soda (zero)', per100: { kcal: 0.5, p: 0, c: 0, f: 0 } },
  { id: 'sports', label: 'Sports drink', per100: { kcal: 25, p: 0, c: 6, f: 0 } },
  { id: 'shake', label: 'Protein shake', per100: { kcal: 60, p: 8, c: 4, f: 1 } },
]
export const DRINK_BY_ID = Object.fromEntries(DRINKS.map(d => [d.id, d]))

/** What a day's fluid goal is when none is set: 35 ml per kg, plus training, rounded — or 2.5 l. */
export const DEFAULT_WATER_ML = 2500
export function suggestWaterMl(weightKg) {
  const w = num(weightKg)
  if (!w) return DEFAULT_WATER_ML
  return Math.round((w * 35 + 500) / 250) * 250
}
export const waterGoalOf = S => nutritionOf(S).waterGoal || DEFAULT_WATER_ML

export const dayDrinks = (S, iso) => nutritionOf(S).drinks[iso] || []

/** Total millilitres drunk; every drink is fluid, whatever else it brings. */
export const dayFluidMl = (S, iso) => Math.round(dayDrinks(S, iso).reduce((n, d) => n + num(d.ml), 0))

/** A drink's energy and macros, from its stored per-100 ml values. */
export function drinkMacros(d) {
  const per100 = d?.per100 || DRINK_BY_ID[d?.kind]?.per100 || ZERO
  return scale(per100, d?.ml)
}

export function drinkTotals(list) {
  const out = { kcal: 0, p: 0, c: 0, f: 0 }
  for (const d of list || []) {
    const m = drinkMacros(d)
    out.kcal += m.kcal; out.p += m.p; out.c += m.c; out.f += m.f
  }
  return { kcal: Math.round(out.kcal), p: round1(out.p), c: round1(out.c), f: round1(out.f) }
}

/** Millilitres per kind of drink on a day, largest first: [{ kind, label, ml }]. */
export function fluidByKind(S, iso) {
  const by = new Map()
  for (const d of dayDrinks(S, iso)) {
    const k = DRINK_BY_ID[d.kind] ? d.kind : 'other'
    by.set(k, (by.get(k) || 0) + num(d.ml))
  }
  return [...by.entries()].map(([kind, ml]) => ({ kind, label: DRINK_BY_ID[kind]?.label || 'Other', ml: Math.round(ml) })).sort((a, b) => b.ml - a.ml)
}

/** A new drink of a known kind (inside a store update). */
export function addDrink(s, iso, kind, ml, now = Date.now()) {
  const n = ensureNutrition(s)
  const known = DRINK_BY_ID[kind] || DRINK_BY_ID.water
  const amount = Math.round(num(ml))
  if (!amount) return null
  const d = { id: now.toString(36) + Math.random().toString(36).slice(2, 7), kind: known.id, ml: amount, per100: macros(known.per100), t: now }
  n.drinks = n.drinks || {}
  n.drinks[iso] = [...(n.drinks[iso] || []), d]
  return d
}

export function removeDrink(s, iso, id) {
  const n = ensureNutrition(s)
  const rest = (n.drinks?.[iso] || []).filter(d => d.id !== id)
  if (rest.length) n.drinks[iso] = rest
  else if (n.drinks) delete n.drinks[iso]
}

/** Average fluid over the `days` days ending on `iso`, counting only days with drinks logged. */
export function averageFluidMl(S, iso, days = 7) {
  const n = nutritionOf(S)
  let count = 0, sum = 0
  for (let i = 0; i < days; i++) {
    const list = n.drinks[shiftDay(iso, -i)]
    if (!list || !list.length) continue
    count++
    sum += list.reduce((a, d) => a + num(d.ml), 0)
  }
  return count ? { days: count, ml: Math.round(sum / count) } : null
}
