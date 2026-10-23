// Looking food up in Open Food Facts (openfoodfacts.org) — a free, open database of packaged food
// with good coverage of Danish supermarket products. Read-only, no key. Only the barcode or the
// search words leave the device.
//
// Two ways in: a barcode (the product endpoint, answered with CORS, so the browser asks it
// directly) and a text search. Open Food Facts' search endpoints send no CORS headers, so a
// browser cannot read them from another site: the search goes through the app's own
// /api/food-search first (a Vercel function, frontend/api/food-search.js) and only falls back to
// asking Open Food Facts directly — the newer search service, then the classic one — where that
// route does not exist.
// Every answer is turned into the app's own food shape by parseProduct, which is the part with a
// test: a product without energy per 100 g is of no use for counting and is dropped.

const FIELDS = 'code,product_name,product_name_da,product_name_en,generic_name,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit,countries_tags'
const PRODUCT = code => `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`
const SEARCH_OWN = q => `api/food-search?q=${encodeURIComponent(q)}`
const SEARCH_NEW = q => `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=30&langs=da,en&fields=${FIELDS}`
const SEARCH_OLD = q => `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=30&fields=${FIELDS}`

const TIMEOUT_MS = 12000

const n = v => {
  const x = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v)
  return Number.isFinite(x) && x >= 0 ? x : null
}
const r1 = x => Math.round(x * 10) / 10
const pick = v => (Array.isArray(v) ? v[0] : v)

/** One Open Food Facts product → { name, brand, code, per100, serving, dk } or null. */
export function parseProduct(p) {
  if (!p || typeof p !== 'object') return null
  const nm = p.nutriments || {}
  let kcal = n(nm['energy-kcal_100g'])
  if (kcal == null) {
    const kj = n(nm['energy-kj_100g']) ?? (nm.energy_unit === 'kcal' ? null : n(nm.energy_100g))
    if (kj != null) kcal = kj / 4.184
    else if (nm.energy_unit === 'kcal') kcal = n(nm.energy_100g)
  }
  if (kcal == null) return null
  const name = [p.product_name_da, p.product_name, p.product_name_en, p.generic_name]
    .map(s => (typeof s === 'string' ? s.trim() : ''))
    .find(Boolean)
  if (!name) return null
  const brands = pick(p.brands)
  const brand = typeof brands === 'string' ? brands.split(',')[0].trim() : ''
  const unit = String(p.serving_quantity_unit || 'g').toLowerCase()
  const sq = n(p.serving_quantity)
  const serving = sq && sq > 0 && sq < 2000 && (unit === 'g' || unit === 'ml') ? r1(sq) : null
  const countries = Array.isArray(p.countries_tags) ? p.countries_tags : []
  return {
    name: name.slice(0, 120),
    brand: brand.slice(0, 80),
    code: p.code ? String(p.code) : '',
    per100: {
      kcal: Math.round(kcal),
      p: r1(n(nm.proteins_100g) || 0),
      c: r1(n(nm.carbohydrates_100g) || 0),
      f: r1(n(nm.fat_100g) || 0),
    },
    serving,
    dk: countries.includes('en:denmark'),
  }
}

/** A list of products → foods, unusable ones dropped, duplicates (same barcode) once, Danish first. */
export function parseProducts(list) {
  const seen = new Set()
  const out = []
  for (const p of Array.isArray(list) ? list : []) {
    const f = parseProduct(p)
    if (!f) continue
    const k = f.code || f.name.toLowerCase() + '|' + f.brand.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(f)
  }
  return out.sort((a, b) => (b.dk ? 1 : 0) - (a.dk ? 1 : 0))
}

async function getJSON(url, fetchFn) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null
  try {
    const res = await fetchFn(url, { signal: ctl?.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { status: res.status })
    return await res.json()
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const defaultFetch = (...a) => fetch(...a)

/** A barcode → a food, or null when the database does not know it (or knows it without energy). */
export async function lookupBarcode(code, fetchFn = defaultFetch) {
  const clean = String(code || '').replace(/\D/g, '')
  if (!clean) return null
  try {
    const data = await getJSON(PRODUCT(clean), fetchFn)
    if (!data || data.status === 0 || !data.product) return null
    const f = parseProduct({ code: clean, ...data.product })
    return f ? { ...f, code: f.code || clean } : null
  } catch (e) {
    if (e && e.status === 404) return null
    throw e
  }
}

/** Search words → foods. Throws only when both search services fail. */
export async function searchFoods(q, fetchFn = defaultFetch) {
  const query = String(q || '').trim()
  if (query.length < 2) return []
  let firstError = null
  try {
    const data = await getJSON(SEARCH_OWN(query), fetchFn)
    if (Array.isArray(data?.products)) return parseProducts(data.products)
  } catch (e) { firstError = e }
  try {
    const data = await getJSON(SEARCH_NEW(query), fetchFn)
    const list = parseProducts(data?.hits)
    if (list.length) return list
  } catch (e) { firstError = firstError || e }
  try {
    const data = await getJSON(SEARCH_OLD(query), fetchFn)
    return parseProducts(data?.products)
  } catch (e) {
    throw firstError || e
  }
}
