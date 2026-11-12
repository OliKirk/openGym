import { describe, expect, it } from 'vitest'
import { DEFAULT_DAILY, addCount, allDoneOn, completeGoal, countOn, dailyGoalsOf, dailyStreak, progressOn, setCount, setDailyGoals } from './daily.js'

const day = '2026-11-12'

describe('daily tasks', () => {
  it('starts with push-ups, sit-ups and steps and nothing counted', () => {
    const S = {}
    expect(dailyGoalsOf(S).map(g => g.id)).toEqual(['pushups', 'situps', 'steps'])
    expect(progressOn(S, day).every(g => g.count === 0 && !g.complete)).toBe(true)
    expect(allDoneOn(S, day)).toBe(false)
  })

  it('adds up through the day and never goes below zero', () => {
    const s = {}
    addCount(s, day, 'pushups', 25)
    addCount(s, day, 'pushups', 25)
    addCount(s, day, 'situps', 10)
    addCount(s, day, 'situps', -30)
    expect(countOn(s, day, 'pushups')).toBe(50)
    expect(countOn(s, day, 'situps')).toBe(0)
    expect(s.daily.log[day]).toEqual({ pushups: 50 })
    const p = progressOn(s, day).find(g => g.id === 'pushups')
    expect(p.share).toBe(0.5)
  })

  it('sets an exact count (steps from a watch), drops empty days', () => {
    const s = {}
    setCount(s, day, 'steps', '8.234')             // Danish thousands separator
    expect(countOn(s, day, 'steps')).toBe(8234)
    setCount(s, day, 'steps', '10,500')
    expect(countOn(s, day, 'steps')).toBe(10500)
    setCount(s, day, 'steps', '12,6')              // a decimal comma still rounds
    expect(countOn(s, day, 'steps')).toBe(13)
    setCount(s, day, 'steps', 8234)
    expect(countOn(s, day, 'steps')).toBe(8234)
    setCount(s, day, 'steps', 0)
    expect(s.daily.log[day]).toBeUndefined()
  })

  it('is done when every target is reached', () => {
    const s = {}
    completeGoal(s, day, 'pushups')
    completeGoal(s, day, 'situps')
    expect(allDoneOn(s, day)).toBe(false)
    setCount(s, day, 'steps', 12000)
    completeGoal(s, day, 'steps')                  // already past the target: kept
    expect(countOn(s, day, 'steps')).toBe(12000)
    expect(allDoneOn(s, day)).toBe(true)
  })

  it('counts a streak back from today, or from yesterday while today is open', () => {
    const s = {}
    for (const d of ['2026-11-09', '2026-11-10', '2026-11-11']) for (const g of DEFAULT_DAILY) completeGoal(s, d, g.id)
    expect(dailyStreak(s, day)).toBe(3)
    for (const g of DEFAULT_DAILY) completeGoal(s, day, g.id)
    expect(dailyStreak(s, day)).toBe(4)
    expect(dailyStreak(s, '2026-11-14')).toBe(0)
  })

  it('edits the list: keeps ids, drops empty names, fixes bad numbers', () => {
    const s = {}
    setDailyGoals(s, [
      { id: 'pushups', name: ' Armbøjninger ', target: 150, unit: 'reps', step: 15 },
      { name: '', target: 10 },
      { name: 'Planke', target: '3', unit: 'min', step: 0 },
      { name: 'Løb', target: -5, unit: 'weird' },
    ], 1000)
    expect(s.daily.goals).toEqual([
      { id: 'pushups', name: 'Armbøjninger', target: 150, unit: 'reps', step: 15 },
      { id: 'rs2', name: 'Planke', target: 3, unit: 'min', step: 10 },
      { id: 'rs3', name: 'Løb', target: 1, unit: 'reps', step: 10 },
    ])
  })
})
