import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import {
  MEALS, MEAL_LABELS, ACTIVITY, GOALS, nutritionOf, calcGoals, kcalFromMacros, latestWeightKg,
  dayEntries, dayTotals, entryTotals, sumTotals, progress, mealForTime, shiftDay, averageTotals,
  rememberFood, filterFoods, foodEntry, quickEntry, addEntry, updateEntry, removeEntry, ensureNutrition, scale,
  DRINKS, DRINK_BY_ID, dayDrinks, dayFluidMl, drinkMacros, fluidByKind, waterGoalOf, suggestWaterMl, addDrink, removeDrink, averageFluidMl,
  rememberDrink, drinkName,
  supplementsOf, takenOn, toggleTaken, takeAll, supplementStreak, setSupplements,
} from '../lib/nutrition.js'
import { lookupBarcode, searchFoods } from '../lib/food-api.js'
import { fmtDate, fmtNum, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, Check, NumberField, SearchField, Segmented, SelectRow, TextField } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'
import './nutrition.css'

const update = fn => useStore.getState().update(fn)
const toast = message => useUI.getState().toast(message)
const openSheet = render => useUI.getState().openSheet(render)

const MEAL_OPTIONS = MEALS.map(m => ({ value: m, label: t(MEAL_LABELS[m]) }))
const g = v => fmtNum(Math.round((Number(v) || 0) * 10) / 10)

function dayLabel(iso) {
  const today = todayISO()
  if (iso === today) return t('Today')
  if (iso === shiftDay(today, -1)) return t('Yesterday')
  if (iso === shiftDay(today, 1)) return t('Tomorrow')
  return fmtDate(iso, true)
}

/* ------------------------------------------------------------------ pieces -- */

function Ring({ value, goal, size = 132 }) {
  const stroke = 11
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const { pct, left } = progress(value, goal)
  const over = left != null && left < 0
  return (
    <div className="nut-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={over ? 'var(--orange)' : 'var(--acc)'} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="nut-ring-c">
        <b>{left == null ? fmtNum(value) : fmtNum(Math.abs(Math.round(left)))}</b>
        <span>{left == null ? 'kcal' : over ? t('kcal over') : t('kcal left')}</span>
      </div>
    </div>
  )
}

function MacroBar({ label, value, goal, color }) {
  const { pct } = progress(value, goal)
  return (
    <div className="nut-macro">
      <div className="nut-macro-h"><span>{label}</span><span><b>{g(value)}</b>{goal ? ' / ' + fmtNum(goal) : ''} g</span></div>
      <div className="nut-bar"><i style={{ width: (goal ? pct * 100 : 0) + '%', background: color }} /></div>
    </div>
  )
}

const macroLine = m => `${fmtNum(Math.round(m.kcal))} kcal · P ${g(m.p)} · C ${g(m.c)} · F ${g(m.f)}`

/* ------------------------------------------------------------------ goals -- */

function GoalsSheet({ close }) {
  const S = useStore(s => s.S)
  const n = nutritionOf(S)
  const saved = n.profile || {}
  const [sex, setSex] = useState(saved.sex || (S.body === 'female' ? 'female' : 'male'))
  const [age, setAge] = useState(saved.age ?? null)
  const [height, setHeight] = useState(saved.height ?? null)
  const [weight, setWeight] = useState(saved.weight ?? latestWeightKg(S))
  const [activity, setActivity] = useState(saved.activity || 1.725)
  const [goal, setGoal] = useState(saved.goal || 'maintain')
  const [goals, setGoals] = useState(n.goals || { kcal: null, p: null, c: null, f: null })
  const [water, setWater] = useState(n.waterGoal ?? suggestWaterMl(saved.weight ?? latestWeightKg(S)))
  const profile = { sex, age, height, weight, activity, goal }
  const calc = calcGoals(profile)

  const useCalc = () => {
    if (!calc) { toast(t('Fill in age, height and weight first')); return }
    setGoals(calc)
    setWater(suggestWaterMl(weight))
  }
  const save = () => {
    if (!goals.kcal) { toast(t('Set a calorie goal')); return }
    update(s => {
      const nn = ensureNutrition(s)
      nn.profile = profile
      nn.goals = { kcal: Math.round(goals.kcal), p: Math.round(goals.p || 0), c: Math.round(goals.c || 0), f: Math.round(goals.f || 0) }
      nn.waterGoal = water > 0 ? Math.round(water) : null
    })
    close()
    toast(t('Goals saved'))
  }
  const macroKcal = kcalFromMacros(goals)
  const field = (label, value, set, unit) => (
    <label className="nut-field"><span>{label}</span><span className="nut-input"><NumberField nullable value={value} onChange={set} /><i>{unit}</i></span></label>
  )

  return <>
    <h3>{t('Daily goals')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Calculated from your body and training. You can adjust the numbers before saving.')}</div>
    <Segmented className="nut-seg" value={sex} onChange={setSex} options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]} />
    <div className="nut-grid3">
      {field(t('Age'), age, setAge, t('yrs'))}
      {field(t('Height'), height, setHeight, 'cm')}
      {field(t('Weight'), weight, setWeight, 'kg')}
    </div>
    <div className="sect-b" style={{ marginBottom: 10 }}>
      <SelectRow title={t('Activity')} sheetTitle={t('Activity level')} value={activity} onChange={setActivity} stackedValue
        options={ACTIVITY.map(a => ({ value: a.value, label: t(a.label) }))} />
    </div>
    <Segmented className="nut-seg" value={goal} onChange={setGoal} options={GOALS.map(o => ({ value: o.value, label: t(o.label) }))} />
    <Button variant="tinted" icon="calculator" onClick={useCalc}>{calc ? t('Use calculated: {0} kcal', fmtNum(calc.kcal)) : t('Calculate')}</Button>
    <h4 className="sec">{t('Your goals per day')}</h4>
    <div className="nut-grid2">
      {field(t('Calories'), goals.kcal, v => setGoals(o => ({ ...o, kcal: v })), 'kcal')}
      {field(t('Protein'), goals.p, v => setGoals(o => ({ ...o, p: v })), 'g')}
      {field(t('Carbs'), goals.c, v => setGoals(o => ({ ...o, c: v })), 'g')}
      {field(t('Fat'), goals.f, v => setGoals(o => ({ ...o, f: v })), 'g')}
    </div>
    {goals.kcal > 0 && macroKcal > 0 && Math.abs(macroKcal - goals.kcal) > 50 &&
      <div className="small" style={{ color: 'var(--orange)', margin: '-4px 2px 10px' }}>{t('Your macros add up to {0} kcal.', fmtNum(macroKcal))}</div>}
    {field(t('Fluid'), water, setWater, 'ml')}
    <div className="muted small" style={{ margin: '4px 2px 14px' }}>{t('About 35 ml per kg plus extra for training. Drink more on badminton and gym days.')}</div>
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export const goalsSheet = () => openSheet(close => <GoalsSheet close={close} />)

/* --------------------------------------------------------- barcode camera -- */

function Scanner({ onCode, onCancel }) {
  const videoRef = useRef(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let stream = null, timer = null, done = false
    const stop = () => { done = true; if (timer) clearTimeout(timer); if (stream) stream.getTracks().forEach(tr => tr.stop()) }
    ;(async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setError('unavailable'); return }
      let read
      try { ({ readFoodCode: read } = await import('../lib/barcode-scan.js')) } catch { setError('unavailable'); return }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false })
      } catch (e) {
        setError(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'unavailable'); return
      }
      if (done) { stream.getTracks().forEach(tr => tr.stop()); return }
      const v = videoRef.current
      if (!v) return
      v.srcObject = stream
      try { await v.play() } catch { /* the loop waits for frames */ }
      const tick = async () => {
        if (done) return
        if (v.readyState >= 2) {
          let code = null
          try { code = await read(v) } catch { /* keep trying */ }
          if (code && !done) { stop(); try { navigator.vibrate?.(30) } catch { /* no vibration */ } onCode(code); return }
        }
        timer = setTimeout(tick, 200)
      }
      tick()
    })()
    return stop
  }, [onCode])

  return <>
    {error
      ? <div className="muted small" style={{ margin: '8px 0 16px', lineHeight: 1.5 }}>
          {error === 'denied' ? t('Camera access was denied. Allow it in your browser settings and try again.') : t('No camera available here. Search for the food instead.')}
        </div>
      : <>
          <div className="cam-wrap nut-cam">
            <video ref={videoRef} playsInline muted autoPlay />
            <div className="nut-cam-frame" aria-hidden="true" />
          </div>
          <div className="muted small" style={{ textAlign: 'center', margin: '12px 0 16px' }}>{t('Point the camera at the barcode')}</div>
        </>}
    <Button variant="tinted" onClick={onCancel}>{t('Back')}</Button>
  </>
}

/* ------------------------------------------------------------- add food -- */

function FoodRow({ food, onClick, right }) {
  return (
    <button className="lrow tap nut-food" onClick={onClick}>
      <span className="lrow-m">
        <span className="lrow-t">{food.name}</span>
        <span className="lrow-s">{[food.brand, fmtNum(food.per100.kcal) + ' kcal / 100 g', food.serving ? t('portion {0} g', fmtNum(food.serving)) : ''].filter(Boolean).join(' · ')}</span>
      </span>
      {right}
    </button>
  )
}

function AmountStep({ food, meal: initialMeal, onAdd, onBack, entry }) {
  const [grams, setGrams] = useState(entry?.grams ?? food.serving ?? 100)
  const [meal, setMeal] = useState(entry?.meal || initialMeal)
  const total = scale(food.per100, grams)
  const chips = [...new Set([food.serving, 50, 100, 150, 200, 250].filter(Boolean))].slice(0, 5)
  return <>
    <div className="row" style={{ gap: 8, marginBottom: 6 }}>
      {onBack && <button className="iconbtn" onClick={onBack} aria-label={t('Back')}><Icon name="chevronLeft" /></button>}
      <div style={{ minWidth: 0 }}>
        <h3 style={{ margin: 0 }}>{food.name}</h3>
        <div className="muted small">{[food.brand, macroLine(food.per100) + ' ' + t('per 100 g')].filter(Boolean).join(' · ')}</div>
      </div>
    </div>
    <label className="nut-field nut-amount"><span>{t('Amount')}</span><span className="nut-input"><NumberField value={grams} onChange={setGrams} /><i>g</i></span></label>
    <div className="nut-chips">
      {chips.map(c => <button key={c} className={'nut-chip' + (Number(grams) === c ? ' on' : '')} onClick={() => setGrams(c)}>
        {c === food.serving ? t('1 portion ({0} g)', fmtNum(c)) : fmtNum(c) + ' g'}</button>)}
    </div>
    <Segmented className="nut-seg" value={meal} onChange={setMeal} options={MEAL_OPTIONS} />
    <div className="nut-preview">
      <div><b>{fmtNum(total.kcal)}</b><span>kcal</span></div>
      <div><b>{g(total.p)}</b><span>{t('Protein')}</span></div>
      <div><b>{g(total.c)}</b><span>{t('Carbs')}</span></div>
      <div><b>{g(total.f)}</b><span>{t('Fat')}</span></div>
    </div>
    <Button variant="primary" disabled={!(grams > 0)} onClick={() => onAdd(grams, meal)}>{entry ? t('Save') : t('Add')}</Button>
  </>
}

function NewFoodStep({ initial, onSave, onBack }) {
  const [name, setName] = useState(initial?.name || '')
  const [brand, setBrand] = useState(initial?.brand || '')
  const [v, setV] = useState({ kcal: null, p: null, c: null, f: null, ...(initial?.per100 || {}) })
  const [serving, setServing] = useState(initial?.serving ?? null)
  const set = k => x => setV(o => ({ ...o, [k]: x }))
  const field = (label, value, onChange, unit) => <label className="nut-field"><span>{label}</span><span className="nut-input"><NumberField nullable value={value} onChange={onChange} /><i>{unit}</i></span></label>
  const save = () => {
    if (!name.trim()) { toast(t('Give the food a name')); return }
    if (!(v.kcal > 0)) { toast(t('Enter the calories per 100 g')); return }
    onSave({ name: name.trim(), brand: brand.trim(), code: initial?.code || '', per100: v, serving })
  }
  return <>
    <div className="row" style={{ gap: 8, marginBottom: 10 }}>
      <button className="iconbtn" onClick={onBack} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <h3 style={{ margin: 0 }}>{t('New food')}</h3>
    </div>
    {initial?.code && <div className="muted small" style={{ marginBottom: 10 }}>{t('Barcode {0} wasn’t found. Add it once and it is saved for next time.', initial.code)}</div>}
    <TextField value={name} maxLength={120} placeholder={t('Name, e.g. Chicken breast')} onChange={e => setName(e.target.value)} />
    <div style={{ height: 8 }} />
    <TextField value={brand} maxLength={80} placeholder={t('Brand (optional)')} onChange={e => setBrand(e.target.value)} />
    <h4 className="sec">{t('Per 100 g (see the label)')}</h4>
    <div className="nut-grid2">
      {field(t('Calories'), v.kcal, set('kcal'), 'kcal')}
      {field(t('Protein'), v.p, set('p'), 'g')}
      {field(t('Carbs'), v.c, set('c'), 'g')}
      {field(t('Fat'), v.f, set('f'), 'g')}
    </div>
    {field(t('One portion (optional)'), serving, setServing, 'g')}
    <div style={{ height: 6 }} />
    <Button variant="primary" onClick={save}>{t('Save food')}</Button>
  </>
}

function QuickStep({ meal: initialMeal, onAdd, onBack }) {
  const [name, setName] = useState('')
  const [v, setV] = useState({ kcal: null, p: null, c: null, f: null })
  const [meal, setMeal] = useState(initialMeal)
  const set = k => x => setV(o => ({ ...o, [k]: x }))
  const field = (label, value, onChange, unit) => <label className="nut-field"><span>{label}</span><span className="nut-input"><NumberField nullable value={value} onChange={onChange} /><i>{unit}</i></span></label>
  return <>
    <div className="row" style={{ gap: 8, marginBottom: 10 }}>
      <button className="iconbtn" onClick={onBack} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <h3 style={{ margin: 0 }}>{t('Quick add')}</h3>
    </div>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Just the numbers — for a meal out or something you already know.')}</div>
    <TextField value={name} maxLength={120} placeholder={t('What was it? (optional)')} onChange={e => setName(e.target.value)} />
    <div style={{ height: 10 }} />
    <div className="nut-grid2">
      {field(t('Calories'), v.kcal, set('kcal'), 'kcal')}
      {field(t('Protein'), v.p, set('p'), 'g')}
      {field(t('Carbs'), v.c, set('c'), 'g')}
      {field(t('Fat'), v.f, set('f'), 'g')}
    </div>
    <Segmented className="nut-seg" value={meal} onChange={setMeal} options={MEAL_OPTIONS} />
    <Button variant="primary" disabled={!(v.kcal > 0)} onClick={() => onAdd(name, v, meal)}>{t('Add')}</Button>
  </>
}

function AddFood({ iso, meal, close, startWith }) {
  // Selected as stored: nutritionOf builds a fresh empty list for a profile without one, and a
  // selector that returns a new array every time re-renders forever.
  const saved = useStore(s => s.S.nutrition?.foods)
  const foods = useMemo(() => (Array.isArray(saved) ? saved : []), [saved])
  const [step, setStep] = useState(startWith || 'pick')   // pick | amount | new | quick | scan
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [food, setFood] = useState(null)
  const [draft, setDraft] = useState(null)
  const asked = useRef('')

  const mine = useMemo(() => filterFoods(foods, q).slice(0, q ? 30 : 40), [foods, q])

  const search = async () => {
    const query = q.trim()
    if (query.length < 2 || busy) return
    asked.current = query
    setBusy(true); setFailed(false); setResults(null)
    try {
      const list = await searchFoods(query)
      if (asked.current === query) setResults(list)
    } catch {
      if (asked.current === query) setFailed(true)
    } finally { setBusy(false) }
  }

  const pick = f => { setFood(f); setStep('amount') }
  const add = (grams, chosenMeal) => {
    update(s => {
      const saved = rememberFood(s, food)
      addEntry(s, iso, foodEntry(saved, grams, chosenMeal))
    })
    close()
    toast(t('Added {0}', food.name))
  }

  const onCode = useCallback(async code => {
    const known = nutritionOf(useStore.getState().S).foods.find(f => f.code === code)
    if (known) { setFood(known); setStep('amount'); return }
    setStep('pick'); setBusy(true); setFailed(false)
    try {
      const found = await lookupBarcode(code)
      if (found) { setFood(found); setStep('amount') }
      else { setDraft({ code }); setStep('new') }
    } catch {
      toast(t('No connection to the food database. Try again or add the food yourself.'))
      setDraft({ code }); setStep('new')
    } finally { setBusy(false) }
  }, [])

  if (step === 'scan') return <><h3>{t('Scan barcode')}</h3><Scanner onCode={onCode} onCancel={() => setStep('pick')} /></>
  if (step === 'amount' && food) return <AmountStep food={food} meal={meal} onAdd={add} onBack={() => setStep('pick')} />
  if (step === 'new') return <NewFoodStep initial={draft} onBack={() => setStep('pick')} onSave={f => { setFood(f); setStep('amount') }} />
  if (step === 'quick') return <QuickStep meal={meal} onBack={() => setStep('pick')} onAdd={(name, v, m) => {
    update(s => addEntry(s, iso, quickEntry(name, v, m)))
    close(); toast(t('Added'))
  }} />

  return <>
    <h3>{t('Add food')} <span className="muted" style={{ fontWeight: 400 }}>· {t(MEAL_LABELS[meal])}</span></h3>
    <form onSubmit={e => { e.preventDefault(); search() }} className="row" style={{ gap: 8, marginBottom: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <SearchField value={q} placeholder={t('Search, e.g. skyr or havregryn')} enterKeyHint="search"
          onChange={e => { setQ(e.target.value); setResults(null); setFailed(false) }} onClear={() => { setQ(''); setResults(null) }} />
      </div>
      <Button type="submit" variant="tinted" className="nut-search-btn" disabled={q.trim().length < 2 || busy}>{t('Search')}</Button>
    </form>
    <div className="nut-actions">
      <button className="nut-action" onClick={() => setStep('scan')}><Icon name="camera" /><span>{t('Scan barcode')}</span></button>
      <button className="nut-action" onClick={() => setStep('quick')}><Icon name="bolt" /><span>{t('Quick add')}</span></button>
      <button className="nut-action" onClick={() => { setDraft(q ? { name: q } : null); setStep('new') }}><Icon name="plus" /><span>{t('New food')}</span></button>
    </div>

    {busy && <div className="muted small nut-status">{t('Searching…')}</div>}
    {failed && <div className="small nut-status" style={{ color: 'var(--orange)' }}>{t('The food database didn’t answer. Check your connection, or add the food yourself.')}</div>}

    {mine.length > 0 && <>
      <h4 className="sec">{q ? t('My foods') : t('Recent and saved')}</h4>
      <div className="sect-b">{mine.map(f => <FoodRow key={f.id} food={f} onClick={() => pick(f)} />)}</div>
    </>}

    {results && <>
      <h4 className="sec">{t('Open Food Facts')}</h4>
      {results.length
        ? <div className="sect-b">{results.map((f, i) => <FoodRow key={(f.code || '') + i} food={f} onClick={() => pick(f)} right={f.dk ? <span className="nut-dk">DK</span> : null} />)}</div>
        : <div className="muted small nut-status">{t('Nothing found. Try other words, or add it as a new food.')}</div>}
    </>}

    {!q && !mine.length && !busy && <div className="muted small nut-status">{t('Search for a food, scan its barcode, or add your own. Foods you use are saved here for next time.')}</div>}
    <div style={{ height: 10 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}

export const addFoodSheet = (iso, meal, startWith) => openSheet(close => <AddFood iso={iso} meal={meal} close={close} startWith={startWith} />)

/* ---------------------------------------------------------- edit an entry -- */

function EditEntry({ iso, entry, close }) {
  const remove = () => {
    update(s => removeEntry(s, iso, entry.id))
    close(); toast(t('Removed {0}', entry.name))
  }
  if (entry.quick) {
    return <EditQuick iso={iso} entry={entry} close={close} onRemove={remove} />
  }
  const food = { name: entry.name, brand: entry.brand, per100: entry.per100, serving: null }
  return <>
    <AmountStep food={food} meal={entry.meal} entry={entry} onAdd={(grams, meal) => {
      update(s => updateEntry(s, iso, entry.id, { grams: Math.round(grams * 10) / 10, meal }))
      close()
    }} />
    <div style={{ height: 8 }} />
    <Button variant="ghost" style={{ color: 'var(--red)' }} icon="trash" onClick={remove}>{t('Remove')}</Button>
  </>
}

function EditQuick({ iso, entry, close, onRemove }) {
  const [v, setV] = useState({ ...entry.quick })
  const [meal, setMeal] = useState(entry.meal)
  const set = k => x => setV(o => ({ ...o, [k]: x }))
  const field = (label, value, onChange, unit) => <label className="nut-field"><span>{label}</span><span className="nut-input"><NumberField nullable value={value} onChange={onChange} /><i>{unit}</i></span></label>
  return <>
    <h3>{entry.name}</h3>
    <div className="nut-grid2">
      {field(t('Calories'), v.kcal, set('kcal'), 'kcal')}
      {field(t('Protein'), v.p, set('p'), 'g')}
      {field(t('Carbs'), v.c, set('c'), 'g')}
      {field(t('Fat'), v.f, set('f'), 'g')}
    </div>
    <Segmented className="nut-seg" value={meal} onChange={setMeal} options={MEAL_OPTIONS} />
    <Button variant="primary" onClick={() => { update(s => updateEntry(s, iso, entry.id, { quick: v, meal })); close() }}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" style={{ color: 'var(--red)' }} icon="trash" onClick={onRemove}>{t('Remove')}</Button>
  </>
}

const editEntrySheet = (iso, entry) => openSheet(close => <EditEntry iso={iso} entry={entry} close={close} />)


/* ---------------------------------------------------------------- drinks -- */

const fmtL = ml => (ml >= 1000 ? (Math.round(ml / 10) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' L' : fmtNum(Math.round(ml)) + ' ml')
const clock = ts => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
const DRINK_ICON = { water: 'drop', coffee: 'cup', tea: 'cup', milk: 'drop', juice: 'drop', soda: 'drop', zero: 'drop', sports: 'bolt', shake: 'dumbbell' }

function DrinkSheet({ iso, close }) {
  const saved = useStore(st => st.S.nutrition?.savedDrinks)
  const mine = Array.isArray(saved) ? saved : []
  const [step, setStep] = useState('pick')       // pick | scan | search
  const [kind, setKind] = useState('water')
  const [product, setProduct] = useState(null)   // a scanned, searched or saved drink
  const [ml, setMl] = useState(250)
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)

  const choose = p => { setProduct(p); setMl(p.serving || 330); setStep('pick') }
  const chooseKind = k => { setProduct(null); setKind(k) }
  const m = product ? drinkMacros({ per100: product.per100, ml }) : drinkMacros({ kind, ml })
  const name = product ? product.name : t(DRINK_BY_ID[kind].label)

  const add = () => {
    if (!(ml > 0)) return
    update(s => {
      if (product) addDrink(s, iso, rememberDrink(s, product), ml)
      else addDrink(s, iso, kind, ml)
    })
    close()
    toast(t('Added {0}', fmtL(ml) + ' ' + (product ? name : name.toLowerCase())))
  }

  const onCode = useCallback(async code => {
    const known = (useStore.getState().S.nutrition?.savedDrinks || []).find(x => x.code === code)
    if (known) { choose(known); return }
    setStep('pick'); setBusy(true)
    try {
      const found = await lookupBarcode(code)
      if (found) choose(found)
      else toast(t('That barcode isn’t in the database. Search for the drink or pick a type.'))
    } catch {
      toast(t('No connection to the food database. Try again or pick a type.'))
    } finally { setBusy(false) }
  }, [])

  const search = async () => {
    if (q.trim().length < 2 || busy) return
    setBusy(true); setResults(null)
    try { setResults(await searchFoods(q.trim())) } catch { setResults([]); toast(t('The food database didn’t answer. Check your connection.')) }
    finally { setBusy(false) }
  }

  if (step === 'scan') return <><h3>{t('Scan a drink')}</h3><Scanner onCode={onCode} onCancel={() => setStep('pick')} /></>
  if (step === 'search') return <>
    <div className="row" style={{ gap: 8, marginBottom: 10 }}>
      <button className="iconbtn" onClick={() => setStep('pick')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <h3 style={{ margin: 0 }}>{t('Search drinks')}</h3>
    </div>
    <form onSubmit={e => { e.preventDefault(); search() }} className="row" style={{ gap: 8, marginBottom: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <SearchField value={q} placeholder={t('e.g. Monster or Faxe Kondi')} enterKeyHint="search" onChange={e => { setQ(e.target.value); setResults(null) }} onClear={() => { setQ(''); setResults(null) }} />
      </div>
      <Button type="submit" variant="tinted" className="nut-search-btn" disabled={q.trim().length < 2 || busy}>{t('Search')}</Button>
    </form>
    {busy && <div className="muted small nut-status">{t('Searching…')}</div>}
    {results && (results.length
      ? <div className="sect-b">{results.map((f, i) => <FoodRow key={(f.code || '') + i} food={f} onClick={() => choose(f)} right={f.dk ? <span className="nut-dk">DK</span> : null} />)}</div>
      : <div className="muted small nut-status">{t('Nothing found. Try other words, or pick a type of drink.')}</div>)}
  </>

  return <>
    <h3>{t('Add a drink')}</h3>
    <div className="nut-actions nut-actions2">
      <button className="nut-action" onClick={() => setStep('scan')}><Icon name="camera" /><span>{t('Scan barcode')}</span></button>
      <button className="nut-action" onClick={() => setStep('search')}><Icon name="magnifier" /><span>{t('Search')}</span></button>
    </div>
    {busy && <div className="muted small nut-status">{t('Looking up the barcode…')}</div>}
    {mine.length > 0 && <>
      <div className="nut-sub">{t('Your drinks')}</div>
      <div className="nut-drinks">
        {mine.slice(0, 8).map(x => <button key={x.id} className={'nut-chip' + (product?.id === x.id || (product?.code && product.code === x.code) ? ' on' : '')} onClick={() => choose(x)}>{x.name}</button>)}
      </div>
    </>}
    <div className="nut-sub">{t('Type')}</div>
    <div className="nut-drinks">
      {DRINKS.map(x => <button key={x.id} className={'nut-chip' + (!product && kind === x.id ? ' on' : '')} onClick={() => chooseKind(x.id)}>{t(x.label)}</button>)}
    </div>
    {product && <div className="nut-product">
      <b>{product.name}</b>
      <span className="muted small">{[product.brand, fmtNum(product.per100.kcal) + ' kcal · ' + t('sugar/carbs {0} g', g(product.per100.c)) + ' ' + t('per 100 ml')].filter(Boolean).join(' · ')}</span>
    </div>}
    <label className="nut-field nut-amount"><span>{t('Amount')}</span><span className="nut-input"><NumberField value={ml} onChange={setMl} decimal={false} /><i>ml</i></span></label>
    <div className="nut-chips">
      {[...new Set([product?.serving, 150, 200, 250, 330, 500, 750].filter(Boolean))].slice(0, 7).map(c => <button key={c} className={'nut-chip' + (Number(ml) === c ? ' on' : '')} onClick={() => setMl(c)}>{c === product?.serving ? t('1 can/bottle ({0} ml)', fmtNum(c)) : fmtNum(c) + ' ml'}</button>)}
    </div>
    {m.kcal > 0
      ? <div className="nut-preview">
          <div><b>{fmtNum(m.kcal)}</b><span>kcal</span></div>
          <div><b>{g(m.p)}</b><span>{t('Protein')}</span></div>
          <div><b>{g(m.c)}</b><span>{t('Carbs')}</span></div>
          <div><b>{g(m.f)}</b><span>{t('Fat')}</span></div>
        </div>
      : <div className="muted small" style={{ margin: '12px 2px 14px' }}>{t('Counts as fluid, no calories.')}</div>}
    <Button variant="primary" disabled={!(ml > 0)} onClick={add}>{t('Add')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

const drinkSheet = iso => openSheet(close => <DrinkSheet iso={iso} close={close} />)

function WaterCard({ S, iso }) {
  const goal = waterGoalOf(S)
  const ml = dayFluidMl(S, iso)
  const list = [...dayDrinks(S, iso)].sort((a, b) => b.t - a.t)
  const kinds = fluidByKind(S, iso)
  const [open, setOpen] = useState(false)
  const pct = Math.min(1, ml / goal)
  const quick = amount => {
    update(s => { addDrink(s, iso, 'water', amount) })
    toast(t('+{0} water', fmtL(amount)))
  }
  const remove = d => update(s => removeDrink(s, iso, d.id))
  return <div className="card nut-water">
    <div className="row between" style={{ alignItems: 'flex-end' }}>
      <div>
        <div className="muted small">{t('Water & drinks')}</div>
        <div className="nut-water-n"><b>{fmtL(ml)}</b><span> / {fmtL(goal)}</span></div>
      </div>
      <div className="nut-water-left small">{ml >= goal ? t('Goal reached') : t('{0} to go', fmtL(goal - ml))}</div>
    </div>
    <div className="nut-bar nut-water-bar"><i style={{ width: pct * 100 + '%', background: 'var(--blue)' }} /></div>
    {kinds.length > 0 && <div className="nut-kinds small">{kinds.map(k => <span key={k.kind}>{k.product ? k.label : t(k.label)} <b>{fmtL(k.ml)}</b></span>)}</div>}
    <div className="nut-water-btns">
      <button className="nut-wbtn" onClick={() => quick(250)}><Icon name="drop" /><span>+250 ml</span></button>
      <button className="nut-wbtn" onClick={() => quick(500)}><Icon name="drop" /><span>+500 ml</span></button>
      <button className="nut-wbtn" onClick={() => drinkSheet(iso)}><Icon name="plus" /><span>{t('Other drink')}</span></button>
    </div>
    {list.length > 0 && <>
      <button className="nut-water-toggle small" onClick={() => setOpen(o => !o)}>
        {open ? t('Hide drinks') : t('Show drinks ({0})', list.length)} <Icon name={open ? 'chevronUp' : 'chevronDown'} />
      </button>
      {open && <div className="nut-drink-list">{list.map(d => {
        const kc = drinkMacros(d).kcal
        return <div key={d.id} className="nut-drink">
          <Icon name={DRINK_ICON[d.kind] || (d.kind === 'product' ? 'bolt' : 'drop')} />
          <span className="nut-drink-m"><b>{d.kind === 'product' ? drinkName(d) : t(drinkName(d))}</b> {fmtL(d.ml)}{kc > 0 ? <span className="muted"> · {fmtNum(kc)} kcal</span> : null}</span>
          <span className="muted small">{clock(d.t)}</span>
          <button className="nut-x" onClick={() => remove(d)} aria-label={t('Remove')}><Icon name="xmark" /></button>
        </div>
      })}</div>}
    </>}
  </div>
}


/* ------------------------------------------------------------ supplements -- */

function SupplementEditor({ close }) {
  const S = useStore(st => st.S)
  const [rows, setRows] = useState(() => supplementsOf(S).map(x => ({ ...x })))
  const set = (i, k, v) => setRows(r => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  const save = () => {
    update(s => setSupplements(s, rows))
    close(); toast(t('Supplements saved'))
  }
  return <>
    <h3>{t('Your supplements')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Name and daily dose. Remove what you no longer take, or add something new.')}</div>
    {rows.map((x, i) => <div key={x.id || i} className="nut-sup-edit">
      <TextField value={x.name} maxLength={60} placeholder={t('Name')} onChange={e => set(i, 'name', e.target.value)} />
      <TextField value={x.dose} maxLength={40} placeholder={t('Dose')} onChange={e => set(i, 'dose', e.target.value)} />
      <button className="nut-x" onClick={() => setRows(r => r.filter((_, j) => j !== i))} aria-label={t('Remove')}><Icon name="trash" /></button>
    </div>)}
    <Button variant="ghost" icon="plus" onClick={() => setRows(r => [...r, { name: '', dose: '' }])}>{t('Add supplement')}</Button>
    <div style={{ height: 10 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

const supplementEditor = () => openSheet(close => <SupplementEditor close={close} />)

function SupplementCard({ S, iso }) {
  const list = supplementsOf(S)
  const taken = new Set(takenOn(S, iso))
  const done = list.length > 0 && taken.size === list.length
  const streak = supplementStreak(S, todayISO())
  if (!list.length) return <div className="card nut-sup">
    <div className="row between"><div className="muted small">{t('Supplements')}</div>
      <button className="nut-x" onClick={supplementEditor} aria-label={t('Edit supplements')}><Icon name="pencil" /></button></div>
    <Button variant="tinted" icon="plus" onClick={supplementEditor}>{t('Add your supplements')}</Button>
  </div>
  return <div className={'card nut-sup' + (done ? ' done' : '')}>
    <div className="row between" style={{ alignItems: 'flex-start' }}>
      <div>
        <div className="muted small">{t('Supplements')}</div>
        <div className="nut-sup-n"><b>{taken.size}</b><span> / {list.length} {t('taken')}</span></div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        {streak > 0 && <span className="nut-streak"><Icon name="flame" />{t(streak === 1 ? '{0} day' : '{0} days', streak)}</span>}
        <button className="nut-x" onClick={supplementEditor} aria-label={t('Edit supplements')}><Icon name="pencil" /></button>
      </div>
    </div>
    <div className="nut-sup-list">
      {list.map(x => <div key={x.id} className={'nut-sup-row' + (taken.has(x.id) ? ' on' : '')} onClick={() => update(s => toggleTaken(s, iso, x.id))}>
        <Check checked={taken.has(x.id)} onChange={() => {}} label={x.name} />
        <span className="nut-sup-name">{x.name}</span>
        <span className="muted small">{x.dose}</span>
      </div>)}
    </div>
    {done
      ? <div className="nut-sup-ok small"><Icon name="checkCircle" /> {t('All taken today. Nice!')}</div>
      : <Button variant="tinted" icon="check" onClick={() => { update(s => takeAll(s, iso)); toast(t('All supplements ticked off')) }}>{t('Took them all')}</Button>}
  </div>
}

/* ------------------------------------------------------------------- page -- */

export default function Nutrition() {
  const S = useStore(s => s.S)
  const today = todayISO()
  const [iso, setIso] = useState(today)
  const n = nutritionOf(S)
  const goals = n.goals
  const entries = dayEntries(S, iso)
  const total = dayTotals(S, iso)
  const avg = averageTotals(S, today, 7)
  const avgFluid = averageFluidMl(S, today, 7)

  const copyYesterday = () => {
    const prev = dayEntries(S, shiftDay(iso, -1))
    if (!prev.length) return
    update(s => prev.forEach((e, i) => addEntry(s, iso, { ...e, id: Date.now().toString(36) + i + Math.random().toString(36).slice(2, 5), t: Date.now() })))
    toast(t('Copied {0} items', prev.length))
  }

  return <div className="narrow nut">
    <div className="hdr">
      <div><h1>{t('Food')}</h1><div className="sub">{t('Calories and macros')}</div></div>
      <button className="iconbtn" onClick={goalsSheet} aria-label={t('Daily goals')}><Icon name="target" /></button>
    </div>

    <div className="nut-day">
      <button className="iconbtn" onClick={() => setIso(shiftDay(iso, -1))} aria-label={t('Previous day')}><Icon name="chevronLeft" /></button>
      <button className="nut-day-l" onClick={() => setIso(today)}>{dayLabel(iso)}</button>
      <button className="iconbtn" onClick={() => setIso(shiftDay(iso, 1))} disabled={iso >= shiftDay(today, 1)} aria-label={t('Next day')}><Icon name="chevronRight" /></button>
    </div>

    <div className="card nut-sum">
      <div className="nut-sum-top">
        <Ring value={total.kcal} goal={goals?.kcal} />
        <div className="nut-sum-n">
          <div><span className="muted small">{t('Eaten')}</span><b>{fmtNum(total.kcal)}</b></div>
          <div><span className="muted small">{t('Goal')}</span><b>{goals ? fmtNum(goals.kcal) : '–'}</b></div>
        </div>
      </div>
      <MacroBar label={t('Protein')} value={total.p} goal={goals?.p} color="var(--teal)" />
      <MacroBar label={t('Carbs')} value={total.c} goal={goals?.c} color="var(--orange)" />
      <MacroBar label={t('Fat')} value={total.f} goal={goals?.f} color="var(--purple)" />
      {!goals && <><div style={{ height: 12 }} /><Button variant="tinted" icon="target" onClick={goalsSheet}>{t('Set your daily goals')}</Button></>}
    </div>

    <WaterCard S={S} iso={iso} />

    <SupplementCard S={S} iso={iso} />

    {MEALS.map(meal => {
      const list = entries.filter(e => (e.meal || 'snacks') === meal)
      const sum = sumTotals(list)
      return <div key={meal} className="nut-meal">
        <div className="nut-meal-h">
          <h4 className="sec" style={{ margin: 0 }}>{t(MEAL_LABELS[meal])}{list.length ? <span className="nut-meal-k"> · {fmtNum(sum.kcal)} kcal</span> : null}</h4>
          <button className="nut-add" onClick={() => addFoodSheet(iso, meal)} aria-label={t('Add to {0}', t(MEAL_LABELS[meal]))}><Icon name="plus" /></button>
        </div>
        {list.length > 0 && <div className="sect-b">{list.map(e => {
          const tt = entryTotals(e)
          return <button key={e.id} className="lrow tap" onClick={() => editEntrySheet(iso, e)}>
            <span className="lrow-m">
              <span className="lrow-t nut-name">{e.name}</span>
              <span className="lrow-s">{[e.quick ? (e.name === 'Quick add' ? '' : t('Quick add')) : fmtNum(e.grams) + ' g', e.brand, `P ${g(tt.p)} · C ${g(tt.c)} · F ${g(tt.f)}`].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="nut-kcal">{fmtNum(tt.kcal)}</span>
          </button>
        })}</div>}
      </div>
    })}

    {!entries.length && dayEntries(S, shiftDay(iso, -1)).length > 0 &&
      <div style={{ marginTop: 14 }}><Button variant="ghost" icon="copy" onClick={copyYesterday}>{t('Copy the day before')}</Button></div>}

    <div className="nut-big-add">
      <Button variant="primary" icon="plus" onClick={() => addFoodSheet(iso, iso === today ? mealForTime() : 'snacks')}>{t('Add food')}</Button>
      <Button variant="tinted" icon="camera" onClick={() => addFoodSheet(iso, iso === today ? mealForTime() : 'snacks', 'scan')}>{t('Scan')}</Button>
    </div>

    {avg && avg.days > 1 && <div className="card nut-avg">
      <div className="muted small" style={{ marginBottom: 6 }}>{t('Average over the last 7 days ({0} days logged)', avg.days)}</div>
      <div className="nut-avg-row">
        <div><b>{fmtNum(avg.kcal)}</b><span>kcal</span></div>
        <div><b>{fmtNum(avg.p)}</b><span>{t('Protein')}</span></div>
        <div><b>{fmtNum(avg.c)}</b><span>{t('Carbs')}</span></div>
        <div><b>{fmtNum(avg.f)}</b><span>{t('Fat')}</span></div>
      </div>
      {avgFluid && <div className="muted small" style={{ marginTop: 10, textAlign: 'center' }}>{t('Fluid: {0} a day on average', fmtL(avgFluid.ml))}</div>}
    </div>}
  </div>
}
