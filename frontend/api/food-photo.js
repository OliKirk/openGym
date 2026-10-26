// Vercel serverless function: POST /api/food-photo  { mime, image (base64), note }
//
// Asks Google's Gemini image model what is on the plate and how much of it, and hands back
// { items: [{ name, grams, kcal, protein, carbs, fat }] } for the app to show as a suggestion
// (lib/food-photo.js). Needs GEMINI_API_KEY in the Vercel project's environment variables — a
// free key from Google AI Studio; without one the function answers 503 and the app says so.
// GEMINI_MODEL can name a specific model; otherwise the first of DEFAULT_MODELS that answers is
// used. Keeps nothing: the photo goes to Google and the answer comes back.

// gemini-3.6-flash answered first and well on the free tier (Oct 2026); the rest are fallbacks.
const DEFAULT_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-2.5-flash']
const MAX_BASE64 = 4_000_000

const PROMPT = `Du er ernæringsekspert. Se på billedet af et måltid og find hver ting, der skal spises
(fx brød, pålæg, sovs, dressing, drikkevarer). Vurder for hver ting den spiselige mængde i gram ud fra
tallerken, bestik og emballage, og typiske danske portioner. Angiv kalorier (kcal), protein, kulhydrat
og fedt i gram for HELE den mængde — ikke pr. 100 g. Navngiv tingene kort på dansk. Tag ikke tallerken,
emballage eller ting, der tydeligt ikke spises, med. Er der ingen mad på billedet, så svar med en tom liste.`

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' }, grams: { type: 'NUMBER' }, kcal: { type: 'NUMBER' },
          protein: { type: 'NUMBER' }, carbs: { type: 'NUMBER' }, fat: { type: 'NUMBER' },
        },
        required: ['name', 'grams', 'kcal', 'protein', 'carbs', 'fat'],
      },
    },
  },
  required: ['items'],
}

async function ask(model, key, body) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 40000)
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: ctl.signal,
    })
    const data = await r.json().catch(() => null)
    return { status: r.status, data }
  } finally { clearTimeout(timer) }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return }
  const key = process.env.GEMINI_API_KEY
  if (!key) { res.status(503).json({ error: 'GEMINI_API_KEY is not set' }); return }

  let b = req.body
  if (typeof b === 'string') { try { b = JSON.parse(b) } catch { b = null } }
  const mime = typeof b?.mime === 'string' && /^image\/[a-z+.-]+$/i.test(b.mime) ? b.mime : null
  const image = typeof b?.image === 'string' ? b.image : ''
  if (!mime || !image || image.length > MAX_BASE64) { res.status(400).json({ error: 'bad image' }); return }
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 300) : ''

  const body = {
    contents: [{ role: 'user', parts: [
      { text: PROMPT + (note ? `\n\nBrugerens bemærkning om måltidet: ${note}` : '') },
      { inline_data: { mime_type: mime, data: image } },
    ] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: SCHEMA },
  }

  const models = [process.env.GEMINI_MODEL, ...DEFAULT_MODELS].filter((m, i, a) => m && a.indexOf(m) === i)
  let busy = false
  for (const model of models) {
    let out
    try { out = await ask(model, key, body) } catch { continue }
    if (out.status === 429) { busy = true; continue }
    if (out.status === 404 || out.status === 400 && /not found|not supported/i.test(JSON.stringify(out.data || ''))) continue
    if (out.status === 401 || out.status === 403) { res.status(503).json({ error: 'the key was refused' }); return }
    if (out.status !== 200) continue
    const text = (out.data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('')
    let parsed = null
    try { parsed = JSON.parse(text) } catch { /* fall through */ }
    if (!parsed) continue
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ items: Array.isArray(parsed.items) ? parsed.items : [], model })
    return
  }
  res.status(busy ? 429 : 502).json({ error: busy ? 'free quota used up, try again later' : 'no model answered' })
}
