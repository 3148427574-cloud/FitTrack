// 对应 Mac 版 Views.swift 的 PlanCard：训练计划卡片。
// 卡路里口径与 RemindersSync / .ics 导出的文案必须一致，改一处要改两处。

import {
  baseTotal,
  calories,
  fmt0,
  fmt1,
  fmt2,
  isBodyweight,
  totalCalories,
} from '../engine'
import { WORKOUT_STATUS_LABELS, type PlannedExercise, type PlannedWorkout } from '../models'

export function weightText(ex: PlannedExercise): string {
  if (isBodyweight(ex.name)) return '自重'
  return ex.targetWeightKG > 0 ? `${fmt1(ex.targetWeightKG)}kg` : '待定'
}

export function PlanCard({
  workout,
  bodyWeightKG,
  heightCM,
}: {
  workout: PlannedWorkout
  bodyWeightKG: number
  heightCM: number
}) {
  const base = baseTotal(workout, bodyWeightKG)
  const total = totalCalories(workout, bodyWeightKG, heightCM)
  // 让身高的行程修正可见：这是估算模型里的假设，不是实测值
  const heightFactorNote =
    base > 0 ? `（身高 ${fmt0(heightCM)}cm 行程修正 ×${fmt2(total / base)}）` : ''

  return (
    <div className="card">
      <div className="row between">
        <strong>{workout.splitName}</strong>
        <span className="dim" style={{ fontSize: 13 }}>
          {WORKOUT_STATUS_LABELS[workout.status]}
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
              {ex.targetSets}×{ex.targetReps}  {weightText(ex)}  ·{' '}
              {fmt0(calories(ex, bodyWeightKG, heightCM))} 千卡
            </span>
          </div>
        ))}
      </div>

      <p className="dim" style={{ margin: '10px 0 0', fontSize: 13 }}>
        预计消耗 {fmt0(total)} 千卡{heightFactorNote}
      </p>
    </div>
  )
}