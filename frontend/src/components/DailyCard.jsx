// The daily tasks card on Home (lib/daily.js): each task with today's count, a bar, a quick-add
// button and a tap on the count to type the exact number (steps read off a watch or phone).
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { addCount, completeGoal, dailyGoalsOf, dailyStreak, progressOn, setCount, setDailyGoals } from '../lib/daily.js'
import { applyHealthDays, fetchHealthDays, healthCodeOf, makeCode, pushUrl, setHealthCode, stepsGoalOf } from '../lib/health-steps.js'
import { fmtNum, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { Button, Check, NumberField, TextField } from './ui.jsx'
import './daily.css'

const update = fn => useStore.getState().update(fn)
const toast = message => useUI.getState().toast(message)
const openSheet = render => useUI.getState().openSheet(render)

const UNIT_LABEL = { reps: 'reps', steps: 'steps', min: 'min', km: 'km' }

function CountSheet({ iso, goal, close }) {
  // Kept as typed and read by setCount, which knows "8.234" is eight thousand steps; the shared
  // NumberField would read it as 8.
  const [v, setV] = useState(goal.count ? String(goal.count) : '')
  const chips = [...new Set([goal.step, goal.step * 2, goal.step * 5].filter(x => x < goal.target)), goal.target]
  const save = n => { update(s => setCount(s, iso, goal.id, n)); close() }
  return <>
    <h3>{goal.name}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{goal.unit === 'steps'
      ? t('Type today’s steps from your phone or watch (Apple Health → Steps).')
      : t('How many have you done today in total?')}</div>
    <label className="nut-field nut-amount"><span>{t('Today')}</span>
      <span className="nut-input"><input className="num" type="text" inputMode="numeric" autoFocus value={v}
        onFocus={e => e.target.select()} onChange={e => setV(e.target.value.replace(/[^0-9.,]/g, ''))} /><i>{t(UNIT_LABEL[goal.unit])}</i></span></label>
    <div className="nut-chips">
      {chips.map(c => <button key={c} className="nut-chip" onClick={() => setV(String(c === goal.target ? c : (Number(String(v).replace(/[.,]/g, '')) || 0) + c))}>
        {c === goal.target ? t('All {0}', fmtNum(c)) : '+' + fmtNum(c)}</button>)}
    </div>
    <div style={{ height: 8 }} />
    <Button variant="primary" onClick={() => save(v)}>{t('Save')}</Button>
    {goal.count > 0 && <><div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={() => save(0)}>{t('Reset to 0')}</Button></>}
  </>
}
const countSheet = (iso, goal) => openSheet(close => <CountSheet iso={iso} goal={goal} close={close} />)

function GoalsEditor({ close }) {
  const S = useStore(s => s.S)
  const [list, setList] = useState(() => dailyGoalsOf(S).map(g => ({ ...g })))
  const set = (i, patch) => setList(l => l.map((g, j) => (j === i ? { ...g, ...patch } : g)))
  return <>
    <h3>{t('Daily tasks')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Name, daily target and the size of the quick-add button.')}</div>
    {list.map((g, i) => <div key={g.id || i} className="dly-edit">
      <TextField value={g.name} maxLength={60} placeholder={t('Name')} onChange={e => set(i, { name: e.target.value })} />
      <div className="dly-edit-n">
        <label className="nut-field"><span>{t('Target')}</span><span className="nut-input"><NumberField decimal={false} value={g.target} onChange={x => set(i, { target: x })} /></span></label>
        <label className="nut-field"><span>{t('Quick add')}</span><span className="nut-input"><NumberField decimal={false} value={g.step} onChange={x => set(i, { step: x })} /></span></label>
        <label className="nut-field"><span>{t('Unit')}</span>
          <select className="dly-unit" value={g.unit} onChange={e => set(i, { unit: e.target.value })}>
            {Object.keys(UNIT_LABEL).map(u => <option key={u} value={u}>{t(UNIT_LABEL[u])}</option>)}
          </select></label>
        <button className="nut-x" onClick={() => setList(l => l.filter((_, j) => j !== i))} aria-label={t('Remove {0}', g.name)}><Icon name="trash" /></button>
      </div>
    </div>)}
    <Button variant="tinted" icon="plus" onClick={() => setList(l => [...l, { name: '', target: 10, unit: 'reps', step: 5 }])}>{t('Add task')}</Button>
    <div style={{ height: 10 }} />
    <Button variant="primary" onClick={() => { update(s => setDailyGoals(s, list)); close(); toast(t('Daily tasks saved')) }}>{t('Save')}</Button>
  </>
}
const goalsEditor = () => openSheet(close => <GoalsEditor close={close} />)

const SHORTCUT = 'openGym skridt'

function HealthSheet({ close }) {
  const code = useStore(s => healthCodeOf(s.S))
  const [state, setState] = useState('')
  useEffect(() => { if (!code) update(s => setHealthCode(s, makeCode())) }, [code])
  if (!code) return null
  const url = pushUrl(window.location.origin, code)
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast(t('Address copied')) }
    catch { toast(t('Press and hold the address to copy it')) }
  }
  const test = async () => {
    setState('…')
    try {
      const days = await fetchHealthDays(code)
      const n = Object.keys(days).length
      update(s => applyHealthDays(s, days))
      setState(n ? t('It works: steps from {0} days received.', n) : t('Connected, but no steps have arrived yet. Run the shortcut once.'))
    } catch (e) {
      setState(e?.code === 'setup' ? t('The server part isn’t switched on yet.') : t('No connection. Try again.'))
    }
  }
  return <>
    <h3>{t('Steps from Apple Health')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('A web app can’t read Apple Health itself, so an iPhone shortcut sends your steps here. Set it up once (about 3 minutes).')}</div>
    <ol className="hl-steps">
      <li><b>{t('Copy your personal address')}</b>
        <div className="hl-url" onClick={copy}>{url}</div>
        <Button size="sm" variant="tinted" icon="copy" onClick={copy}>{t('Copy address')}</Button></li>
      <li><b>{t('Make the shortcut')}</b> {t('In the Shortcuts app tap +, and name it “{0}”. Add these actions:', SHORTCUT)}
        <ul>
          <li>{t('“Find Health Samples”: Type = Steps, Start Date = Today, Group by = Day, Limit = 1.')}</li>
          <li>{t('“URL”: paste the address, then tap after = and insert the variable “Health Samples”.')}</li>
          <li>{t('“Get Contents of URL” (it uses the URL above).')}</li>
        </ul></li>
      <li><b>{t('Run it once')}</b> {t('with ▶. Allow access to Health when asked. It answers “Saved in openGym: … steps”.')}</li>
      <li><b>{t('Make it automatic')}</b> {t('Shortcuts → Automation → New → Time of Day, e.g. 21:00 daily → Run Immediately → run “{0}”. Add more times if you like (12:00, 18:00).', SHORTCUT)}</li>
    </ol>
    <div className="row" style={{ gap: 8 }}>
      <Button variant="primary" onClick={test}>{t('Fetch steps now')}</Button>
      <Button onClick={() => { window.location.href = 'shortcuts://run-shortcut?name=' + encodeURIComponent(SHORTCUT) }}>{t('Run shortcut')}</Button>
    </div>
    {state && <div className="small nut-status">{state}</div>}
    <div style={{ height: 6 }} />
    <Button variant="ghost" className="dim" onClick={() => { update(s => setHealthCode(s, null)); close(); toast(t('Apple Health sync turned off')) }}>{t('Turn off')}</Button>
  </>
}
const healthSheet = () => openSheet(close => <HealthSheet close={close} />)

// Pulls the steps the shortcut sent, when Home opens and whenever the app comes back to the front.
function useHealthPull(code) {
  const [at, setAt] = useState(null)
  useEffect(() => {
    if (!code) return
    let alive = true
    const pull = () => fetchHealthDays(code).then(days => {
      if (!alive) return
      update(s => applyHealthDays(s, days))
      setAt(new Date())
    }).catch(() => {})
    pull()
    const onVis = () => { if (document.visibilityState === 'visible') pull() }
    document.addEventListener('visibilitychange', onVis)
    return () => { alive = false; document.removeEventListener('visibilitychange', onVis) }
  }, [code])
  return at
}

export default function DailyCard() {
  const S = useStore(s => s.S)
  const iso = todayISO()
  const code = healthCodeOf(S)
  const pulledAt = useHealthPull(code)
  const hasSteps = !!stepsGoalOf(S)
  const goals = progressOn(S, iso)
  const done = goals.filter(g => g.complete).length
  const streak = dailyStreak(S, iso)
  const all = goals.length > 0 && done === goals.length

  if (!goals.length) return <div className="card dly">
    <div className="row between"><h2 style={{ margin: 0 }}>{t('Daily tasks')}</h2>
      <button className="nut-x" onClick={goalsEditor} aria-label={t('Edit daily tasks')}><Icon name="pencil" /></button></div>
    <div style={{ height: 8 }} />
    <Button variant="tinted" icon="plus" onClick={goalsEditor}>{t('Add a daily task')}</Button>
  </div>

  return <div className={'card dly' + (all ? ' done' : '')}>
    <div className="row between" style={{ alignItems: 'flex-start' }}>
      <div>
        <div className="muted small">{t('Daily tasks')}</div>
        <div className="dly-n"><b>{done}</b><span> / {goals.length} {t('done')}</span></div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        {streak > 0 && <span className="dly-streak"><Icon name="flame" />{t(streak === 1 ? '{0} day' : '{0} days', streak)}</span>}
        <button className="nut-x" onClick={goalsEditor} aria-label={t('Edit daily tasks')}><Icon name="pencil" /></button>
      </div>
    </div>
    <div className="dly-list">
      {goals.map(g => <div key={g.id} className={'dly-row' + (g.complete ? ' on' : '')}>
        <Check checked={g.complete} label={g.name} onChange={() => {
          if (g.complete) countSheet(iso, g)
          else { update(s => completeGoal(s, iso, g.id)); toast(t('{0} done 💪', g.name)) }
        }} />
        <button className="dly-mid" onClick={() => countSheet(iso, g)} aria-label={t('Set {0}', g.name)}>
          <span className="dly-top"><span className="dly-name">{g.name}</span>
            <span className="dly-c"><b>{fmtNum(g.count)}</b> / {fmtNum(g.target)}</span></span>
          <span className="dly-bar"><i style={{ width: (g.share * 100).toFixed(1) + '%' }} /></span>
        </button>
        <button className="dly-add" disabled={g.complete} onClick={() => update(s => addCount(s, iso, g.id, g.step))}
          aria-label={t('Add {0} {1}', fmtNum(g.step), g.name)}>+{g.step >= 1000 ? fmtNum(g.step / 1000) + 'k' : g.step}</button>
      </div>)}
    </div>
    {all && <div className="dly-ok small"><Icon name="checkCircle" /> {t('All done today. Strong work!')}</div>}
    {hasSteps && <button className="dly-health" onClick={healthSheet}>
      <Icon name="heart" />
      <span>{code
        ? (pulledAt ? t('Steps from Apple Health · updated {0}', pulledAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : t('Steps from Apple Health'))
        : t('Get steps automatically from Apple Health')}</span>
      <Icon name="chevronRight" />
    </button>}
  </div>
}
