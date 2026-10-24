import { describe, it, expect } from 'vitest'
import {
  bmr, calcGoals, kcalFromMacros, scale, entryTotals, sumTotals, progress, mealForTime, shiftDay,
  averageTotals, rememberFood, filterFoods, foodEntry, quickEntry, addEntry, updateEntry, removeEntry,
  nutritionOf, latestWeightKg, dayTotals,
} from './nutrition.js'

describe('goals', () => {
  it('uses Mifflin–St Jeor for resting energy', () => {
    expect(bmr({ sex: 'male', weight: 80, height: 183, age: 24 })).toBeCloseTo(10 * 80 + 6.25 * 183 - 5 * 24 + 5)
    expect(bmr({ sex: 'female', weight: 60, height: 168, age: 30 })).toBeCloseTo(600 + 1050 - 150 - 161)
    expect(bmr({ sex: 'male', weight: 80 })).toBe(0)
  })

  it('sets protein at 2 g/kg, fat at least a quarter of energy, carbs the rest', () => {
    const g = calcGoals({ sex: 'male', weight: 80, height: 183, age: 24, activity: 1.725, goal: 'maintain' })
    const tdee = (10 * 80 + 6.25 * 183 - 5 * 24 + 5) * 1.725
    expect(g.kcal).toBe(Math.round(tdee / 10) * 10)
    expect(g.p).toBe(160)
    expect(g.f * 9).toBeGreaterThanOrEqual(g.kcal * 0.25 - 9)
    expect(Math.abs(kcalFromMacros(g) - g.kcal)).toBeLessThan(15)
  })

  it('adjusts energy for the goal', () => {
    const base = { sex: 'male', weight: 80, height: 183, age: 24, activity: 1.55 }
    const m = calcGoals({ ...base, goal: 'maintain' }).kcal
    expect(calcGoals({ ...base, goal: 'cut' }).kcal).toBe(m - 400)
    expect(calcGoals({ ...base, goal: 'bulk' }).kcal).toBe(m + 250)
  })

  it('returns null for an incomplete profile', () => {
    expect(calcGoals({ sex: 'male', weight: 80 })).toBeNull()
    expect(calcGoals(null)).toBeNull()
  })

  it('reads the newest weigh-in, converting pounds', () => {
    expect(latestWeightKg({ unit: 'kg', bodyweight: [{ d: '2026-10-02', w: 81 }, { d: '2026-09-01', w: 79 }] })).toBe(81)
    expect(latestWeightKg({ unit: 'lb', bodyweight: [{ d: '2026-10-02', w: 180 }] })).toBe(81.6)
    expect(latestWeightKg({ bodyweight: [] })).toBeNull()
  })
})

describe('amounts and totals', () => {
  const skyr = { kcal: 63, p: 11, c: 4, f: 0.2 }
  it('scales per-100 g values to an amount', () => {
    expect(scale(skyr, 250)).toEqual({ kcal: 158, p: 27.5, c: 10, f: 0.5 })
    expect(scale(skyr, 0)).toEqual({ kcal: 0, p: 0, c: 0, f: 0 })
    expect(scale(skyr, '150,5').kcal).toBe(95)
  })

  it('totals food and quick-add entries alike', () => {
    const a = foodEntry({ name: 'Skyr', per100: skyr }, 200, 'breakfast', 1)
    const b = quickEntry('Pizza', { kcal: 800, p: 30, c: 90, f: 32 }, 'dinner', 2)
    expect(entryTotals(b)).toEqual({ kcal: 800, p: 30, c: 90, f: 32 })
    expect(sumTotals([a, b])).toEqual({ kcal: 926, p: 52, c: 98, f: 32.4 })
  })

  it('reports progress and what is left', () => {
    expect(progress(1500, 3000)).toEqual({ pct: 0.5, left: 1500 })
    expect(progress(3300, 3000)).toEqual({ pct: 1, left: -300 })
    expect(progress(10, 0)).toEqual({ pct: 0, left: null })
  })

  it('guesses the meal from the time of day', () => {
    const at = h => new Date(2026, 9, 23, h)
    expect(mealForTime(at(7))).toBe('breakfast')
    expect(mealForTime(at(12))).toBe('lunch')
    expect(mealForTime(at(18))).toBe('dinner')
    expect(mealForTime(at(15))).toBe('snacks')
    expect(mealForTime(at(22))).toBe('snacks')
  })

  it('moves dates across months', () => {
    expect(shiftDay('2026-10-31', 1)).toBe('2026-11-01')
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('the log', () => {
  it('adds, edits and removes entries; an emptied day disappears', () => {
    const s = {}
    const e = foodEntry({ name: 'Havregryn', per100: { kcal: 370, p: 13, c: 59, f: 7 } }, 80, 'breakfast', 5)
    addEntry(s, '2026-10-23', e)
    expect(dayTotals(s, '2026-10-23').kcal).toBe(296)
    updateEntry(s, '2026-10-23', e.id, { grams: 100 })
    expect(dayTotals(s, '2026-10-23').kcal).toBe(370)
    removeEntry(s, '2026-10-23', e.id)
    expect(s.nutrition.log['2026-10-23']).toBeUndefined()
  })

  it('averages only the days with food logged', () => {
    const s = {}
    addEntry(s, '2026-10-23', quickEntry('', { kcal: 3000, p: 160 }, 'lunch', 1))
    addEntry(s, '2026-10-21', quickEntry('', { kcal: 2000, p: 140 }, 'lunch', 2))
    expect(averageTotals(s, '2026-10-23', 7)).toMatchObject({ days: 2, kcal: 2500, p: 150 })
    expect(averageTotals({}, '2026-10-23')).toBeNull()
  })

  it('gives older profiles a full, empty shape', () => {
    expect(nutritionOf({})).toEqual({ goals: null, profile: null, log: {}, foods: [], drinks: {}, waterGoal: null, savedDrinks: [], supplements: null, supTaken: {} })
  })
})

describe('saved foods', () => {
  it('keeps one copy per barcode or name+brand, newest first', () => {
    const s = {}
    rememberFood(s, { name: 'Skyr naturel', brand: 'Arla', code: '570', per100: { kcal: 63 } }, 1)
    rememberFood(s, { name: 'Havregryn', brand: 'Øko', per100: { kcal: 370 } }, 2)
    const again = rememberFood(s, { name: 'Skyr Naturel 0,2%', brand: 'Arla', code: '570', per100: { kcal: 64 } }, 3)
    expect(s.nutrition.foods).toHaveLength(2)
    expect(s.nutrition.foods[0].id).toBe(again.id)
    expect(s.nutrition.foods[0].per100.kcal).toBe(64)
    rememberFood(s, { name: 'havregryn', brand: 'øko', per100: { kcal: 371 } }, 4)
    expect(s.nutrition.foods).toHaveLength(2)
  })

  it('searches saved foods by every word', () => {
    const foods = [{ name: 'Skyr naturel', brand: 'Arla' }, { name: 'Kyllingebryst', brand: 'Danpo' }, { name: 'Græsk yoghurt', brand: 'Arla' }]
    expect(filterFoods(foods, 'arla skyr').map(f => f.name)).toEqual(['Skyr naturel'])
    expect(filterFoods(foods, 'arla')).toHaveLength(2)
    expect(filterFoods(foods, '')).toHaveLength(3)
  })
})

import { addDrink, removeDrink, dayDrinks, dayFluidMl, drinkTotals, fluidByKind, suggestWaterMl, waterGoalOf, averageFluidMl, DEFAULT_WATER_ML } from './nutrition.js'

describe('drinks', () => {
  it('logs fluid and counts every drink as fluid', () => {
    const s = {}
    addDrink(s, '2026-10-23', 'water', 500, 1)
    addDrink(s, '2026-10-23', 'coffee', 250, 2)
    addDrink(s, '2026-10-23', 'milk', 250, 3)
    expect(dayFluidMl(s, '2026-10-23')).toBe(1000)
    expect(fluidByKind(s, '2026-10-23').map(x => x.kind)).toEqual(['water', 'coffee', 'milk'])
  })

  it('adds the energy of drinks to the day, not of water', () => {
    const s = {}
    addDrink(s, '2026-10-23', 'water', 1000, 1)
    expect(dayTotals(s, '2026-10-23').kcal).toBe(0)
    addDrink(s, '2026-10-23', 'milk', 500, 2)
    addEntry(s, '2026-10-23', quickEntry('', { kcal: 500, p: 30 }, 'lunch', 3))
    expect(dayTotals(s, '2026-10-23')).toEqual({ kcal: 730, p: 47.5, c: 23.5, f: 7.5 })
    expect(drinkTotals(dayDrinks(s, '2026-10-23')).kcal).toBe(230)
  })

  it('ignores empty amounts and removes drinks; an emptied day disappears', () => {
    const s = {}
    expect(addDrink(s, '2026-10-23', 'water', 0)).toBeNull()
    const d = addDrink(s, '2026-10-23', 'nonsense', 330, 1)
    expect(d.kind).toBe('water')
    removeDrink(s, '2026-10-23', d.id)
    expect(s.nutrition.drinks['2026-10-23']).toBeUndefined()
  })

  it('suggests a fluid goal from body weight and falls back to a default', () => {
    expect(suggestWaterMl(68.7)).toBe(3000)
    expect(suggestWaterMl(null)).toBe(DEFAULT_WATER_ML)
    expect(waterGoalOf({})).toBe(DEFAULT_WATER_ML)
    expect(waterGoalOf({ nutrition: { waterGoal: 3200 } })).toBe(3200)
  })

  it('averages fluid over days with drinks logged', () => {
    const s = {}
    addDrink(s, '2026-10-23', 'water', 3000, 1)
    addDrink(s, '2026-10-20', 'water', 2000, 2)
    expect(averageFluidMl(s, '2026-10-23')).toEqual({ days: 2, ml: 2500 })
  })
})

import { rememberDrink, drinkName } from './nutrition.js'

describe('scanned drinks', () => {
  const monster = { name: 'Monster Energy', brand: 'Monster', code: '5060337500401', per100: { kcal: 47, p: 0, c: 11, f: 0 }, serving: 500 }

  it('logs a product drink with its own name and values per 100 ml', () => {
    const s = {}
    const d = addDrink(s, '2026-10-23', monster, 500, 1)
    expect(d).toMatchObject({ kind: 'product', name: 'Monster Energy', code: '5060337500401', ml: 500 })
    expect(drinkName(d)).toBe('Monster Energy')
    expect(dayFluidMl(s, '2026-10-23')).toBe(500)
    expect(dayTotals(s, '2026-10-23')).toMatchObject({ kcal: 235, c: 55 })
  })

  it('lists each product on its own line next to the built-in kinds', () => {
    const s = {}
    addDrink(s, '2026-10-23', monster, 500, 1)
    addDrink(s, '2026-10-23', 'water', 250, 2)
    addDrink(s, '2026-10-23', monster, 500, 3)
    expect(fluidByKind(s, '2026-10-23').map(x => [x.label, x.ml])).toEqual([['Monster Energy', 1000], ['Water', 250]])
  })

  it('remembers a drink once per barcode, newest first', () => {
    const s = {}
    rememberDrink(s, monster, 1)
    rememberDrink(s, { name: 'Faxe Kondi Booster', brand: 'Royal Unibrew', per100: { kcal: 46 } }, 2)
    rememberDrink(s, { ...monster, name: 'Monster Energy Original' }, 3)
    expect(s.nutrition.savedDrinks.map(x => x.name)).toEqual(['Monster Energy Original', 'Faxe Kondi Booster'])
    expect(s.nutrition.savedDrinks[0].serving).toBe(500)
  })
})

import { supplementsOf, takenOn, allTakenOn, toggleTaken, takeAll, supplementStreak, setSupplements, DEFAULT_SUPPLEMENTS } from './nutrition.js'

describe('supplements', () => {
  it('starts from the default list', () => {
    expect(supplementsOf({}).map(x => x.name)).toEqual(['Kreatin', 'Omega 3', 'Multivitamin', 'Magnesium', 'C-vitamin'])
  })

  it('ticks on and off per day, and all at once', () => {
    const s = {}
    toggleTaken(s, '2026-10-24', 'creatine')
    expect(takenOn(s, '2026-10-24')).toEqual(['creatine'])
    toggleTaken(s, '2026-10-24', 'creatine')
    expect(s.nutrition.supTaken['2026-10-24']).toBeUndefined()
    takeAll(s, '2026-10-24')
    expect(allTakenOn(s, '2026-10-24')).toBe(true)
    expect(takenOn(s, '2026-10-23')).toEqual([])
  })

  it('counts a streak that survives an unfinished today', () => {
    const s = {}
    takeAll(s, '2026-10-21'); takeAll(s, '2026-10-22'); takeAll(s, '2026-10-23')
    expect(supplementStreak(s, '2026-10-24')).toBe(3)
    takeAll(s, '2026-10-24')
    expect(supplementStreak(s, '2026-10-24')).toBe(4)
    toggleTaken(s, '2026-10-22', 'vitc', false)
    expect(supplementStreak(s, '2026-10-24')).toBe(2)
  })

  it('edits the list, keeping ids and dropping empty names; removed items no longer count', () => {
    const s = {}
    takeAll(s, '2026-10-24')
    setSupplements(s, [...DEFAULT_SUPPLEMENTS.slice(0, 2), { name: '  ' }, { name: 'D-vitamin', dose: '1 pille' }])
    expect(supplementsOf(s).map(x => x.name)).toEqual(['Kreatin', 'Omega 3', 'D-vitamin'])
    expect(takenOn(s, '2026-10-24')).toEqual(['creatine', 'omega3'])
    expect(allTakenOn(s, '2026-10-24')).toBe(false)
  })
})
