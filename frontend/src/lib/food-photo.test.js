import { describe, expect, it, vi } from 'vitest'
import { analyzePhoto, parsePhotoItems, photoTotals } from './food-photo.js'

describe('parsePhotoItems', () => {
  it('turns portion totals into values per 100 g', () => {
    const [rice] = parsePhotoItems({ items: [{ name: 'Ris', grams: 250, kcal: 325, protein: 6, carbs: 70, fat: 1 }] })
    expect(rice).toEqual({ name: 'Ris', grams: 250, per100: { kcal: 130, p: 2.4, c: 28, f: 0.4 } })
  })

  it('drops items without a name, grams or calories, and absurd ones', () => {
    const list = parsePhotoItems({ items: [
      { name: '', grams: 100, kcal: 100 },
      { name: 'Nothing', grams: 0, kcal: 100 },
      { name: 'No energy', grams: 100 },
      { name: 'Too big', grams: 9000, kcal: 100 },
      'junk', null,
      { name: 'Pizza', grams: '450', kcal: '1300', protein: '60', carbs: 160, fat: 50 },
    ] })
    expect(list.map(i => i.name)).toEqual(['Pizza'])
    expect(list[0].per100.kcal).toBe(289)
  })

  it('accepts a bare array and missing macros as zero', () => {
    const [x] = parsePhotoItems([{ name: 'Chili', grams: 5, kcal: 1 }])
    expect(x.per100).toEqual({ kcal: 20, p: 0, c: 0, f: 0 })
    expect(parsePhotoItems(null)).toEqual([])
  })
})

describe('photoTotals', () => {
  it('sums the items at their current grams', () => {
    const items = parsePhotoItems({ items: [
      { name: 'Ris', grams: 250, kcal: 325, protein: 6, carbs: 70, fat: 1 },
      { name: 'Karry', grams: 450, kcal: 920, protein: 44, carbs: 50, fat: 60 },
    ] })
    // per-100 g values are rounded, so the totals land within a few units of the model's
    const tot = photoTotals(items)
    expect(Math.abs(tot.kcal - 1245)).toBeLessThanOrEqual(3)
    expect(Math.abs(tot.p - 50)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(tot.c - 120)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(tot.f - 61)).toBeLessThanOrEqual(0.5)
    items[0].grams = 125
    expect(Math.abs(tot.kcal - photoTotals(items).kcal - 130 * 1.25)).toBeLessThanOrEqual(1)
  })
})

describe('analyzePhoto', () => {
  const img = 'data:image/jpeg;base64,AAAA'
  const reply = (status, body) => vi.fn(async () => ({ status, ok: status < 300, json: async () => body }))

  it('posts the image and note and parses the answer', async () => {
    const f = reply(200, { items: [{ name: 'Bolle', grams: 80, kcal: 230, protein: 7, carbs: 42, fat: 4 }] })
    const items = await analyzePhoto(img, 'med smør', f)
    expect(items[0].name).toBe('Bolle')
    const [url, opts] = f.mock.calls[0]
    expect(url).toBe('api/food-photo')
    expect(JSON.parse(opts.body)).toEqual({ mime: 'image/jpeg', image: 'AAAA', note: 'med smør' })
  })

  it('tells setup, busy and failure apart', async () => {
    await expect(analyzePhoto(img, '', reply(503, {}))).rejects.toMatchObject({ code: 'setup' })
    await expect(analyzePhoto(img, '', reply(429, {}))).rejects.toMatchObject({ code: 'busy' })
    await expect(analyzePhoto(img, '', reply(500, {}))).rejects.toMatchObject({ code: 'failed' })
    await expect(analyzePhoto('nope', '', reply(200, {}))).rejects.toMatchObject({ code: 'failed' })
  })
})
