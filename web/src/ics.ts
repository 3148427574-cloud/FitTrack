// 对应 Mac 版 Sources/FitTrack/RemindersSync.swift 里可移植的那一半：
// WorkoutText + ICSExporter。EventKit 那半边是苹果独有，网页版没有对应能力，
// 整块丢弃（训练页因此只有「导出 .ics」，没有「同步到提醒事项」）。

import { baseTotal, calories, fmt0, fmt2, totalCalories, weightText } from './engine'
import type { PlannedExercise, PlannedWorkout } from './models'

export const WorkoutText = {
  weightLabel(ex: PlannedExercise): string {
    return weightText(ex.name, ex.targetWeightKG)
  },

  exerciseLine(ex: PlannedExercise, bodyWeightKG: number, heightCM: number): string {
    const kcal = calories(ex, bodyWeightKG, heightCM)
    return `${ex.name} ${ex.targetSets}x${ex.targetReps} ${WorkoutText.weightLabel(ex)} · ${fmt0(kcal)}千卡`
  },

  exerciseLines(w: PlannedWorkout, bodyWeightKG: number, heightCM: number): string[] {
    return w.exercises.map((ex) => WorkoutText.exerciseLine(ex, bodyWeightKG, heightCM))
  },

  /** 合计行。身高行程修正只在明显偏离 1 时才写出来，免得提醒里全是噪声。 */
  totalLine(w: PlannedWorkout, bodyWeightKG: number, heightCM: number): string | null {
    const total = totalCalories(w, bodyWeightKG, heightCM)
    if (!(total > 0)) return null
    const base = baseTotal(w, bodyWeightKG)
    const factor = base > 0 ? total / base : 1
    if (Math.abs(factor - 1) < 0.005) return `预计消耗 ${fmt0(total)} 千卡`
    return `预计消耗 ${fmt0(total)} 千卡（身高 ${fmt0(heightCM)}cm 行程修正 ×${fmt2(factor)}）`
  },

  note(w: PlannedWorkout, bodyWeightKG: number, heightCM: number): string {
    const lines = WorkoutText.exerciseLines(w, bodyWeightKG, heightCM)
    const t = WorkoutText.totalLine(w, bodyWeightKG, heightCM)
    if (t != null) lines.push(t)
    return lines.join('\n')
  },
}

export const ICSExporter = {
  /** 生成 iCalendar(.ics) 文本，可导入 Apple 日历 / Google 日历（无签名时也能用） */
  ics(forWorkouts: PlannedWorkout[], bodyWeightKG: number, heightCM: number): string {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//FitTrack//Training//CN',
      'CALSCALE:GREGORIAN',
    ]
    for (const w of forWorkouts) {
      lines.push('BEGIN:VEVENT')
      lines.push(`UID:${w.id}@fittrack`)
      lines.push(`DTSTART;VALUE=DATE:${icsDate(w.date)}`)
      lines.push(`SUMMARY:🏋️ 训练：${w.splitName}`)
      const parts = WorkoutText.exerciseLines(w, bodyWeightKG, heightCM)
      const t = WorkoutText.totalLine(w, bodyWeightKG, heightCM)
      if (t != null) parts.push(t)
      lines.push(`DESCRIPTION:${parts.join(', ')}`)
      lines.push('END:VEVENT')
    }
    lines.push('END:VCALENDAR')
    return lines.join('\r\n')
  },
}

/** Swift 侧用 DateFormatter("yyyyMMdd") + TimeZone.current，即用户本地的日历日 */
function icsDate(d: Date): string {
  const y = String(d.getFullYear()).padStart(4, '0')
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}
