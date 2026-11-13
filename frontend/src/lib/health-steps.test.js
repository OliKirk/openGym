import { describe, expect, it, vi } from 'vitest'
import { applyHealthDays, fetchHealthDays, healthCodeOf, makeCode, parseHealthDays, pushUrl, setHealthCode, stepsGoalOf } from './health-steps.js'
import { countOn, setCount, setDailyGoals } from './daily.js'
import { parseSteps } from '../../api/steps.js'

describe('steps from Apple Health', () => {
  it('makes long codes of letters and digits only', () => {
    const a = makeCode(), b = makeCode()
    expect(a).toMatch(/^[A-Za-z0-9]{24}$/)
    expect(a).not.toBe(b)
  })

  it('keeps the code on the daily state', () => {
    const s = {}
    expect(healthCodeOf(s)).toBe(null)
    setHealthCode(s, 'abc123abc123abc123')
    expect(healthCodeOf(s)).toBe('abc123abc123abc123')
    setDailyGoals(s, [{ name: 'Skridt', target: 8000, unit: 'steps' }])
    expect(healthCodeOf(s)).toBe('abc123abc123abc123')
    setHealthCode(s, null)
    expect(healthCodeOf(s)).toBe(null)
  })

  it('builds the shortcut address', () => {
    expect(pushUrl('https://x.vercel.app/', 'CODE')).toBe('https://x.vercel.app/api/steps?code=CODE&steps=')
  })

  it('reads only sane days from the server', () => {
    expect(parseHealthDays({ days: { '2026-11-13': 8234, '2026-11-12': '9001', bad: 5, '2026-11-11': -1, '2026-11-10': 1e9 } }))
      .toEqual({ '2026-11-13': 8234, '2026-11-12': 9001 })
    expect(parseHealthDays(null)).toEqual({})
  })

  it('fills the steps task, never lowering a bigger count', () => {
    const s = {}
    setCount(s, '2026-11-12', 'steps', 12000)
    const n = applyHealthDays(s, { '2026-11-12': 9000, '2026-11-13': 8234 })
    expect(n).toBe(1)
    expect(countOn(s, '2026-11-12', 'steps')).toBe(12000)
    expect(countOn(s, '2026-11-13', 'steps')).toBe(8234)
  })

  it('finds a renamed steps task by its unit, and does nothing without one', () => {
    const s = {}
    setDailyGoals(s, [{ name: 'Armbøjninger', target: 100 }, { name: 'Gåtur', target: 8000, unit: 'steps' }])
    expect(stepsGoalOf(s).name).toBe('Gåtur')
    setDailyGoals(s, [{ name: 'Armbøjninger', target: 100 }])
    expect(applyHealthDays(s, { '2026-11-13': 5000 })).toBe(0)
  })

  it('fetches days and tells a missing setup apart', async () => {
    const ok = vi.fn(async () => ({ status: 200, ok: true, json: async () => ({ days: { '2026-11-13': 5 } }) }))
    expect(await fetchHealthDays('CODE', ok)).toEqual({ '2026-11-13': 5 })
    expect(ok.mock.calls[0][0]).toBe('api/steps?code=CODE')
    await expect(fetchHealthDays('CODE', async () => ({ status: 503, ok: false }))).rejects.toMatchObject({ code: 'setup' })
  })

  it('server reads step counts the way Danish Shortcuts write them', () => {
    expect(parseSteps('8234')).toBe(8234)
    expect(parseSteps('8.234')).toBe(8234)
    expect(parseSteps('8,234')).toBe(8234)
    expect(parseSteps('8234,6')).toBe(8235)
    expect(parseSteps('12 345')).toBe(12345)
    expect(parseSteps('8.234 skridt')).toBe(8234)
    expect(parseSteps('8234 count')).toBe(8234)
    expect(parseSteps('')).toBe(null)
    expect(parseSteps('abc')).toBe(null)
  })
})
