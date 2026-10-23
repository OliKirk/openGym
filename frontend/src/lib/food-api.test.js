import { describe, it, expect } from 'vitest'
import { parseProduct, parseProducts, lookupBarcode, searchFoods } from './food-api.js'

const skyr = {
  code: '5711953064421', product_name: 'Skyr naturel', product_name_da: 'Skyr naturel 0,2%', brands: 'Arla,Arla Foods',
  nutriments: { 'energy-kcal_100g': 63, proteins_100g: 11, carbohydrates_100g: 4, fat_100g: 0.2 },
  serving_quantity: '150', serving_quantity_unit: 'g', countries_tags: ['en:denmark'],
}

const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

describe('parseProduct', () => {
  it('reads name, brand, per-100 g values and the portion', () => {
    expect(parseProduct(skyr)).toEqual({
      name: 'Skyr naturel 0,2%', brand: 'Arla', code: '5711953064421',
      per100: { kcal: 63, p: 11, c: 4, f: 0.2 }, serving: 150, dk: true,
    })
  })

  it('works out kcal from kJ when only energy in kJ is given', () => {
    const p = parseProduct({ product_name: 'Rugbrød', nutriments: { 'energy-kj_100g': 920, proteins_100g: 6 } })
    expect(p.per100.kcal).toBe(220)
    expect(p.per100.c).toBe(0)
  })

  it('drops products without energy or name', () => {
    expect(parseProduct({ product_name: 'Vand', nutriments: {} })).toBeNull()
    expect(parseProduct({ nutriments: { 'energy-kcal_100g': 10 } })).toBeNull()
    expect(parseProduct(null)).toBeNull()
  })

  it('ignores a portion that is not in grams', () => {
    expect(parseProduct({ ...skyr, serving_quantity_unit: 'stk' }).serving).toBeNull()
  })

  it('removes duplicates and puts Danish products first', () => {
    const other = { ...skyr, code: '1', countries_tags: ['en:germany'] }
    const list = parseProducts([other, skyr, skyr, { product_name: 'x', nutriments: {} }])
    expect(list.map(f => f.code)).toEqual(['5711953064421', '1'])
  })
})

describe('lookups', () => {
  it('finds a product by barcode', async () => {
    let asked = ''
    const f = await lookupBarcode('5711953064421', async url => { asked = url; return res({ status: 1, product: skyr }) })
    expect(asked).toContain('/api/v2/product/5711953064421')
    expect(f.name).toBe('Skyr naturel 0,2%')
  })

  it('returns null for an unknown barcode', async () => {
    expect(await lookupBarcode('123', async () => res({ status: 0 }))).toBeNull()
    expect(await lookupBarcode('123', async () => res({}, 404))).toBeNull()
  })

  it('falls back to the classic search when the new one fails', async () => {
    const urls = []
    const list = await searchFoods('skyr', async url => {
      urls.push(url)
      if (url.includes('search.openfoodfacts')) return res({}, 503)
      return res({ products: [skyr] })
    })
    expect(urls).toHaveLength(2)
    expect(list[0].code).toBe('5711953064421')
  })

  it('uses the new search when it answers', async () => {
    const list = await searchFoods('skyr', async () => res({ hits: [skyr] }))
    expect(list).toHaveLength(1)
  })

  it('throws when both searches fail', async () => {
    await expect(searchFoods('skyr', async () => res({}, 500))).rejects.toThrow()
  })
})
