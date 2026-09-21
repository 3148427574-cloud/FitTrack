// 训练页。对应 Mac 版 Views.swift 的 TrainingView / AddLogView。
//
// 与 Mac 版的差异（有意为之）：网页版没有「同步到提醒事项」与「刷新状态」——
// EventKit 是苹果独有，这里只保留「导出 .ics」。

import { useState } from 'react'

import { GeneratePlanButton } from '../components/PlanCard'
import { Card, NumberField, Sheet, formatDate, useConfirmDialog } from '../components/ui'
import { downloadText } from '../download'
import { useAppData } from '../hooks'
import { ICSExporter } from '../ics'
import { newID, type WorkoutSession } from '../models'
import { store } from '../store'

export function Training() {
  const data = useAppData()
  const [hint, setHint] = useState('')
  const [showAddLog, setShowAddLog] = useState(false)
  const { ask, dialog } = useConfirmDialog()

  const upcoming = store.upcomingPlanned()
  const history = store.sortedWorkouts

  function exportICS() {
    downloadText(
      '训练计划.ics',
      ICSExporter.ics(upcoming, store.currentBodyWeightKG, data.profile.heightCM),
      'text/calendar',
    )
  }

  return (
    <>
      <h1>训练</h1>

      <div className="row">
        <GeneratePlanButton onResult={setHint} />
        <button className="btn" onClick={exportICS}>
          导出 .ics 日历
        </button>
        <button className="btn primary" onClick={() => setShowAddLog(true)}>
          记录一次训练
        </button>
      </div>

      {hint !== '' && (
        <p className="dim" style={{ marginTop: 10, fontSize: 13 }}>
          {hint}
        </p>
      )}

      <div style={{ marginTop: 20 }}>
        <Card title="进行中的计划">
          {upcoming.length === 0 ? (
            <p className="empty">暂无待完成计划</p>
          ) : (
            <div className="list">
              {upcoming.map((w) => (
                <div className="list-row" key={w.id}>
                  <div>
                    <strong>
                      {w.splitName} · {formatDate(w.date)}
                    </strong>
                    <div className="dim" style={{ fontSize: 13 }}>
                      {w.exercises.map((e) => e.name).join(' / ')}
                    </div>
                  </div>
                  <div className="row" style={{ flex: '0 0 auto' }}>
                    <button className="btn" onClick={() => store.completePlannedWorkout(w.id)}>
                      完成
                    </button>
                    <button className="btn" onClick={() => store.skipPlannedWorkout(w.id)}>
                      跳过
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title={`历史训练（${history.length} 次）`}
          trailing={
            <button
              className="btn danger"
              disabled={history.length === 0}
              onClick={() =>
                ask({
                  title: '清空所有历史训练记录？',
                  message: `将删除 ${history.length} 条训练记录，且不可恢复。`,
                  confirmLabel: '清空全部',
                  onConfirm: () => store.clearWorkouts(),
                })
              }
            >
              清空全部
            </button>
          }
        >
          {history.length === 0 ? (
            <p className="empty">暂无记录</p>
          ) : (
            <div className="list">
              {history.slice(0, 50).map((w) => (
                <div className="list-row" key={w.id}>
                  <span style={{ flex: '0 0 90px' }}>{formatDate(w.date)}</span>
                  <span style={{ flex: '0 0 80px' }}>{w.splitName}</span>
                  <span
                    className="dim"
                    style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {w.exercises.map((e) => e.name).join(', ')}
                  </span>
                  <button
                    className="btn danger"
                    onClick={() =>
                      ask({
                        title: '删除这条训练记录？',
                        message: `${formatDate(w.date)} · ${w.splitName}`,
                        confirmLabel: '删除',
                        onConfirm: () => store.deleteWorkout(w.id),
                      })
                    }
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {showAddLog && <AddLog onClose={() => setShowAddLog(false)} />}
      {dialog}
    </>
  )
}

function AddLog({ onClose }: { onClose: () => void }) {
  const data = useAppData()
  const [splitName, setSplitName] = useState('训练')
  const [exerciseName, setExerciseName] = useState(data.exercises[0]?.name ?? '')
  const [sets, setSets] = useState(3)
  const [reps, setReps] = useState(8)
  const [weight, setWeight] = useState(0)

  function save() {
    const session: WorkoutSession = {
      id: newID(),
      date: new Date(),
      splitName,
      exercises: [
        {
          id: newID(),
          name: exerciseName,
          sets: Array.from({ length: sets }, () => ({ reps, weightKG: weight })),
        },
      ],
      durationMin: 0,
      notes: '',
    }
    store.addWorkout(session)
    onClose()
  }

  return (
    <Sheet title="记录一次训练" onClose={onClose}>
      <label className="field" style={{ marginBottom: 12 }}>
        <span>拆分名称</span>
        <input value={splitName} onChange={(e) => setSplitName(e.target.value)} />
      </label>

      <label className="field" style={{ marginBottom: 12 }}>
        <span>动作</span>
        <select value={exerciseName} onChange={(e) => setExerciseName(e.target.value)}>
          {data.exercises.map((ex) => (
            <option key={ex.id} value={ex.name}>
              {ex.name}
            </option>
          ))}
        </select>
      </label>

      <div className="row" style={{ marginBottom: 12 }}>
        <NumberField label={`组数 ${sets}`} value={sets} onChange={setSets} min={1} max={10} width={80} />
        <NumberField label={`每组次数 ${reps}`} value={reps} onChange={setReps} min={1} max={30} width={80} />
      </div>

      <NumberField
        label="重量 (kg，自重填 0)"
        value={weight}
        onChange={setWeight}
        min={0}
        step={2.5}
        width={110}
      />

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
        <button className="btn" onClick={onClose}>
          取消
        </button>
        <button className="btn primary" disabled={exerciseName === ''} onClick={save}>
          保存
        </button>
      </div>
    </Sheet>
  )
}