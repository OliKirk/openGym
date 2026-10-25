// Logging a meal from a photo. The picture (shrunk on the phone first) goes to the app's own
// /api/food-photo (a Vercel function, frontend/api/food-photo.js), which asks an image model to
// name what is on the plate and estimate each part: grams and the calories, protein, carbs and fat
// in that amount. What comes back is only a suggestion — the user sees every item and its grams
// before anything is logged.
//
// parsePhotoItems is the part with a test: it turns whatever the model answered into the app's own
// food shape (name, grams, values per 100 g), so a photo item is logged exactly like a searched
// food and its grams can be changed later.

const ENDPOINT = 'api/food-photo'
const TIMEOUT_MS = 45000

const n = v => {
  const x = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v)
  return Number.isFinite(x) && x >= 0 ? x : null
}
const r1 = x => Math.round(x * 10) / 10

/** The model's answer → [{ name, grams, per100: { kcal, p, c, f } }], unusable items dropped. */
export function parsePhotoItems(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
  const out = []
  for (const it of list) {
    if (!it || typeof it !== 'object') continue
    const name = typeof it.name === 'string' ? it.name.trim().slice(0, 120) : ''
    const grams = n(it.grams)
    const kcal = n(it.kcal ?? it.calories)
    if (!name || !grams || grams > 3000 || kcal == null || kcal > 6000) continue
    const per = v => r1(((n(v) || 0) * 100) / grams)
    out.push({
      name,
      grams: Math.round(grams),
      per100: { kcal: Math.round((kcal * 100) / grams), p: per(it.protein ?? it.p), c: per(it.carbs ?? it.c), f: per(it.fat ?? it.f) },
    })
  }
  return out
}

/** The totals of the chosen items at their (possibly edited) grams. */
export function photoTotals(items) {
  const t = { kcal: 0, p: 0, c: 0, f: 0 }
  for (const it of items) {
    const k = (n(it.grams) || 0) / 100
    t.kcal += it.per100.kcal * k; t.p += it.per100.p * k; t.c += it.per100.c * k; t.f += it.per100.f * k
  }
  return { kcal: Math.round(t.kcal), p: r1(t.p), c: r1(t.c), f: r1(t.f) }
}

/** A JPEG data URL (+ an optional note such as "with dressing") → items. Throws an Error whose
 *  `code` is 'setup' (no key on the server), 'busy' (free quota used up for now) or 'failed'. */
export async function analyzePhoto(dataUrl, note = '', fetchFn = (...a) => fetch(...a)) {
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(String(dataUrl || ''))
  if (!m) throw Object.assign(new Error('not an image'), { code: 'failed' })
  const ctl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null
  let res
  try {
    res = await fetchFn(ENDPOINT, {
      method: 'POST',
      signal: ctl?.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ mime: m[1], image: m[2], note: String(note || '').slice(0, 300) }),
    })
  } catch (e) {
    throw Object.assign(new Error('no connection'), { code: 'failed', cause: e })
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (res.status === 503) throw Object.assign(new Error('not set up'), { code: 'setup' })
  if (res.status === 429) throw Object.assign(new Error('busy'), { code: 'busy' })
  if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { code: 'failed' })
  const data = await res.json().catch(() => null)
  return parsePhotoItems(data)
}
