// 训练计划卡（对应 Mac 版 Views.swift 的 PlanCard）。
// 卡路里口径与 .ics 导出的文案必须一致，配重文案统一走 engine.weightText。
//
// 与 Mac 版的差异（网页版新增）：
// - 卡片带「编辑」按钮，打开可增删动作、改组数/次数/重量、改计划名的编辑面板；
// - GeneratePlanButton：先生成部位（胸/背/腿/自定义）再由 AI 或固定模板出计划，
//   Mac 版是按星期固定轮转拆分，没有选择。

import { useState } from 'react'

import { AIService } from '../ai'
import {
  CUSTOM_FOCUS,
  SPLIT_FOCUSES,
  StrengthModel,
  baseTotal,
  calories,
  fmt0,
  fmt2,
  isBodyweight,
  totalCalories,
  weightText,
} from '../engine'
import { useAppData } from '../hooks'
import {
  WORKOUT_STATUS_LABELS,
  newID,
  type PlannedExercise,
  type PlannedWorkout,
} from '../models'
import { store } from '../store'
import { NumberField, Sheet } from './ui'

export function PlanCard({
  workout,
  bodyWeightKG,
  heightCM,
}: {
  workout: PlannedWorkout
  bodyWeightKG: number
  heightCM: number
}) {
  const [editing, setEditing] = useState(false)
  const base = baseTotal(workout, bodyWeightKG)
  const total = totalCalories(workout, bodyWeightKG, heightCM)
  // 让身高的行程修正可见：这是估算模型里的假设，不是实测值
  const heightFactorNote =
    base > 0 ? `（身高 ${fmt0(heightCM)}cm 行程修正 ×${fmt2(total / base)}）` : ''

  return (
    <div className="card">
      <div className="row between">
        <strong>{workout.splitName}</strong>
        <span className="row" style={{ gap: 8 }}>
          <span className="dim" style={{ fontSize: 13 }}>
            {WORKOUT_STATUS_LABELS[workout.status]}
          </span>
          <button className="btn" onClick={() => setEditing(true)}>
            编辑
          </button>
        </span>
      </div>

      {workout.note != null && workout.note !== '' && (
        <p className="dim" style={{ margin: '6px 0 0', fontSize: 13 }}>
          {workout.note}
        </p>
      )}

      <div className="list" style={{ marginTop: 10 }}>
        {workout.exercises.map((ex) => (
          <div className="row between exercise-line" key={ex.id}>
            <span className="name">{ex.name}</span>
            <span className="meta">
              {ex.targetSets}×{ex.targetReps}  {weightText(ex.name, ex.targetWeightKG)}  ·{' '}
              {fmt0(calories(ex, bodyWeightKG, heightCM))} 千卡
            </span>
          </div>
        ))}
      </div>

      <p className="dim" style={{ margin: '10px 0 0', fontSize: 13 }}>
        预计消耗 {fmt0(total)} 千卡{heightFactorNote}
      </p>

      {editing && <PlanEditor workout={workout} onClose={() => setEditing(false)} />}
    </div>
  )
}

/**
 * 今日计划的可编辑面板。
 * 不做额外的配重推导：用户手填多少就是多少，只在换动作时把自重动作的重量清零。
 */
function PlanEditor({
  workout,
  onClose,
}: {
  workout: PlannedWorkout
  onClose: () => void
}) {
  const data = useAppData()
  const [splitName, setSplitName] = useState(workout.splitName)
  const [rows, setRows] = useState<PlannedExercise[]>(() =>
    workout.exercises.map((e) => ({ ...e })),
  )

  // 计划里可能有动作库外的动作（比如 Mac 版导进来的），一并给个选项，免得下拉框把它吃掉
  const names = data.exercises.map((e) => e.name)
  for (const r of rows) {
    if (!names.includes(r.name)) names.push(r.name)
  }

  function patchRow(id: string, patch: Partial<PlannedExercise>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function addRow() {
    const name = names[0] ?? '杠铃卧推'
    const reps = 10
    const weight = isBodyweight(name)
      ? 0
      : StrengthModel.prescribedWeight(name, reps, data, store.currentBodyWeightKG)
    setRows((prev) => [
      ...prev,
      { id: newID(), name, targetSets: 3, targetReps: reps, targetWeightKG: Math.max(0, weight) },
    ])
  }

  function save() {
    const name = splitName.trim()
    store.updatePlannedWorkout(workout.id, {
      splitName: name === '' ? workout.splitName : name,
      exercises: rows,
    })
    onClose()
  }

  return (
    <Sheet title="编辑今日计划" onClose={onClose}>
      <label className="field" style={{ marginBottom: 12 }}>
        <span>计划名称</span>
        <input
          value={splitName}
          placeholder="胸 / 背 / 腿 / 自定名称"
          onChange={(e) => setSplitName(e.target.value)}
        />
      </label>

      <div className="list" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
        {rows.map((row) => (
          <div
            className="list-row"
            key={row.id}
            style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}
          >
            <div className="row between" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <select
                value={row.name}
                style={{ flex: 1 }}
                onChange={(e) =>
                  patchRow(row.id, {
                    name: e.target.value,
                    targetWeightKG: isBodyweight(e.target.value) ? 0 : row.targetWeightKG,
                  })
                }
              >
                {names.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <button
                className="btn danger"
                onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
              >
                删除
              </button>
            </div>

            <div className="row">
              <NumberField
                label="组数"
                value={row.targetSets}
                min={1}
                max={10}
                width={64}
                onChange={(v) => patchRow(row.id, { targetSets: v })}
              />
              <NumberField
                label="次数"
                value={row.targetReps}
                min={1}
                max={30}
                width={64}
                onChange={(v) => patchRow(row.id, { targetReps: v })}
              />
              <NumberField
                label="重量 (kg)"
                value={row.targetWeightKG}
                min={0}
                step={2.5}
                width={78}
                onChange={(v) => patchRow(row.id, { targetWeightKG: v })}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={addRow}>
          添加动作
        </button>
        {rows.length === 0 && (
          <span className="dim" style={{ fontSize: 13 }}>
            至少保留一个动作才能保存
          </span>
        )}
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
        <button className="btn" onClick={onClose}>
          取消
        </button>
        <button className="btn primary" disabled={rows.length === 0} onClick={save}>
          保存
        </button>
      </div>
    </Sheet>
  )
}

/** 生成今日计划：先选部位（胸/背/腿/自定义），再交给 AI 或固定模板 */
export function GeneratePlanButton({ onResult }: { onResult?: (message: string) => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [focus, setFocus] = useState<string>('胸')
  const [custom, setCustom] = useState('')

  const hasKey = AIService.hasKey()
  const chosen = focus === CUSTOM_FOCUS ? custom.trim() : focus

  async function generate() {
    if (chosen === '' || busy) return
    setBusy(true)
    const { plan, usedAI } = await AIService.generatePlanWithFallback(store.data, new Date(), chosen)
    const added = store.addPlannedWorkout(plan)
    setBusy(false)
    setOpen(false)
    onResult?.(
      !added
        ? `今日已有「${chosen}」计划，未重复添加`
        : usedAI
          ? `已由 AI 生成「${chosen}」计划`
          : `未设置 API Key，已用固定模板生成「${chosen}」计划（在「AI 助手」页设置 Key 后可启用 AI 生成）`,
    )
  }

  return (
    <>
      <button className="btn" disabled={busy} onClick={() => setOpen(true)}>
        {busy ? '生成中…' : '生成今日计划'}
      </button>

      {open && (
        <Sheet title="生成今日计划" onClose={() => setOpen(false)}>
          <div className="dim" style={{ fontSize: 13, marginBottom: 8 }}>
            选择今天练什么
          </div>
          <div className="row" style={{ marginBottom: 12 }}>
            {SPLIT_FOCUSES.map((f) => (
              <button
                key={f}
                className={`btn${focus === f ? ' primary' : ''}`}
                onClick={() => setFocus(f)}
              >
                {f}
              </button>
            ))}
          </div>

          {focus === CUSTOM_FOCUS && (
            <label className="field" style={{ marginBottom: 12 }}>
              <span>自定义内容（部位或动作，如「肩+三头」「全身」）</span>
              <input
                value={custom}
                placeholder="肩+三头"
                onChange={(e) => setCustom(e.target.value)}
              />
            </label>
          )}

          <p className="dim" style={{ fontSize: 13, margin: '0 0 14px' }}>
            {hasKey
              ? '将结合训练历史与身体数据，由 AI 生成动作与配重。'
              : '未设置 API Key：将用固定模板生成（在「AI 助手」页设置 Key 后可启用 AI 生成）。'}
          </p>

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setOpen(false)}>
              取消
            </button>
            <button className="btn primary" disabled={busy || chosen === ''} onClick={generate}>
              生成
            </button>
          </div>
        </Sheet>
      )}
    </>
  )
}