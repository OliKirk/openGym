// Vercel serverless function: GET /api/food-search?q=skyr
//
// Open Food Facts answers its product endpoint (barcodes) with CORS, so the app asks it directly,
// but its search endpoints do not — a browser on another site cannot read them. This function
// runs the same search server-side and hands the products back from the app's own origin. It
// keeps nothing and sends nothing but the search words on to Open Food Facts.
//
// Only used by the Vercel deployment; a self-hosted openGym has no /api/food-search and the
// app falls back to asking Open Food Facts directly (lib/food-api.js).

const FIELDS = 'code,product_name,product_name_da,product_name_en,generic_name,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit,countries_tags'
const UA = 'openGym-personal/1.0 (self-hosted gym tracker; food search)'

async function get(url) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 9000)
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctl.signal })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    return await r.json()
  } finally { clearTimeout(timer) }
}

export default async function handler(req, res) {
  const q = String((req.query && req.query.q) || '').trim().slice(0, 80)
  if (q.length < 2) { res.status(400).json({ error: 'q too short' }); return }
  const enc = encodeURIComponent(q)
  const tries = [
    async () => (await get(`https://search.openfoodfacts.org/search?q=${enc}&page_size=30&langs=da,en&fields=${FIELDS}`)).hits,
    async () => (await get(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${enc}&search_simple=1&action=process&json=1&page_size=30&fields=${FIELDS}`)).products,
  ]
  let lastError = null
  for (const run of tries) {
    try {
      const products = await run()
      if (Array.isArray(products) && products.length) {
        // The same words give the same answer for a while: let Vercel's edge keep it a day.
        res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800')
        res.status(200).json({ products })
        return
      }
    } catch (e) { lastError = e }
  }
  if (lastError) { res.status(502).json({ error: 'search unavailable' }); return }
  res.setHeader('Cache-Control', 'public, s-maxage=3600')
  res.status(200).json({ products: [] })
}
