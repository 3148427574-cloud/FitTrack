// 对应 Mac 版 Sources/FitTrack/Importer.swift。
//
// 对外统一契约：`weight_kg`（对外 schema）与 `weightKG`（App 自己导出的驼峰）都要接受，
// 否则「导出 JSON」产出的备份根本导不回来（2026-09-20 踩过）。
//
// 与 Mac 版的差异：Swift 用 `inout AppData` 原地追加，TS 没有 inout，
// 所以返回追加后的新对象，页面拿它调 store.replaceData()。

import {
  CURRENT_SCHEMA_VERSION,
  decodeJSON,
  encodeJSON,
  newID,
  SEED_EXERCISES,
  SEED_FOODS,
  type AppData,
  type BigThreeMax,
  type BodyMetric,
  type ChatMessage,
  type DietCalibration,
  type DietEvaluation,
  type DietLog,
  type ExerciseDef,
  type ExerciseEntry,
  type Food,
  type Goal,
  type PlannedWorkout,
  type UserProfile,
  type WorkoutSession,
} from './models'

// MARK: - 导入 Schema

export interface ImportSet {
  reps: number
  weight_kg: number
}

export interface ImportExercise {
  name: string
  sets: ImportSet[]
  rpe?: number
}

export interface ImportWorkout {
  date: string
  split?: string
  durationMin?: number
  exercises?: ImportExercise[]
}

export interface ImportBodyMetric {
  date: string
  weight_kg: number
  bodyFatPct?: number
  muscleMassKG?: number
  waistCM?: number
  chestCM?: number
  armCM?: number
  thighCM?: number
}

export interface ImportSchema {
  version?: string
  source?: string
  workouts?: ImportWorkout[]
  bodyMetrics?: ImportBodyMetric[]
  /** 导出文件里附带的聊天历史；非必填，缺了就跳过 */
  chat?: ChatMessage[]
}

export interface ImportResult {
  workouts: number
  metrics: number
  chat: ChatMessage[]
  message: string
}

function emptyResult(): ImportResult {
  return { workouts: 0, metrics: 0, chat: [], message: '' }
}

// MARK: - 小工具

function isObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null
}

/** 表格单元格里的数：空串不算数字（Swift 的 Double("") 是 nil） */
function cellNumber(v: string | undefined): number | null {
  if (v == null) return null
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return isFinite(n) ? n : null
}

function cellInt(v: string | undefined): number | null {
  if (v == null) return null
  const t = v.trim()
  if (!/^[+-]?\d+$/.test(t)) return null
  return parseInt(t, 10)
}

/** 取 `weight_kg`（优先）或 `weightKG`，都没有则 null */
function pickWeight(o: Record<string, unknown>): number | null {
  return asNumber(o.weight_kg) ?? asNumber(o.weightKG)
}

// MARK: - 日期解析

const ISO_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/
const DATE_DASH = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_SLASH = /^(\d{4})\/(\d{2})\/(\d{2})$/
const DATETIME_DASH = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
const DATETIME_SLASH = /^(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/

/** 与 Swift 的 DateParse.parse 同一组格式；无时区的一律按本地时间 */
export function parseDate(s: string): Date | null {
  const t = s.trim()
  if (t === '') return null

  if (ISO_WITH_ZONE.test(t)) {
    const d = new Date(t)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const m =
    DATE_DASH.exec(t) ?? DATE_SLASH.exec(t) ?? DATETIME_DASH.exec(t) ?? DATETIME_SLASH.exec(t)
  if (m == null) return null
  const [, y, mo, d, hh = '0', mm = '0', ss = '0'] = m
  const date = new Date(+y, +mo - 1, +d, +hh, +mm, +ss)
  return Number.isNaN(date.getTime()) ? null : date
}

// MARK: - CSV 解析

/** 与 Swift 的 CSVParser 一致：制表符优先，其次分号，最后逗号；支持 `""` 转义与 CRLF */
export function parseCSV(text: string): string[][] {
  const delimiter = text.includes('\t') ? '\t' : text.includes(';') ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => !r.every((f) => f.trim() === ''))
}

// MARK: - JSON 导入

/** 对应 Swift 的整包 Codable 解码：任一条目缺必填字段就整体失败 */
function decodeSchema(raw: unknown): ImportSchema | null {
  if (!isObject(raw)) return null

  const out: ImportSchema = {}
  if (typeof raw.version === 'string') out.version = raw.version
  if (typeof raw.source === 'string') out.source = raw.source

  if (raw.workouts !== undefined) {
    if (!Array.isArray(raw.workouts)) return null
    const workouts: ImportWorkout[] = []
    for (const w of raw.workouts) {
      if (!isObject(w) || typeof w.date !== 'string') return null
      const item: ImportWorkout = { date: w.date }
      if (w.split !== undefined) {
        if (typeof w.split !== 'string') return null
        item.split = w.split
      }
      if (w.durationMin !== undefined) {
        const v = asNumber(w.durationMin)
        if (v == null) return null
        item.durationMin = v
      }
      if (w.exercises !== undefined) {
        if (!Array.isArray(w.exercises)) return null
        const exercises: ImportExercise[] = []
        for (const e of w.exercises) {
          if (!isObject(e) || typeof e.name !== 'string' || !Array.isArray(e.sets)) return null
          const sets: ImportSet[] = []
          for (const s of e.sets) {
            if (!isObject(s)) return null
            const weight = pickWeight(s)
            if (weight == null) return null
            sets.push({ reps: asNumber(s.reps) ?? 0, weight_kg: weight })
          }
          const ex: ImportExercise = { name: e.name, sets }
          const rpe = asNumber(e.rpe)
          if (rpe != null) ex.rpe = rpe
          exercises.push(ex)
        }
        item.exercises = exercises
      }
      workouts.push(item)
    }
    out.workouts = workouts
  }

  if (raw.bodyMetrics !== undefined) {
    if (!Array.isArray(raw.bodyMetrics)) return null
    const metrics: ImportBodyMetric[] = []
    for (const m of raw.bodyMetrics) {
      if (!isObject(m) || typeof m.date !== 'string') return null
      const weight = pickWeight(m)
      if (weight == null) return null
      const item: ImportBodyMetric = { date: m.date, weight_kg: weight }
      for (const k of [
        'bodyFatPct',
        'muscleMassKG',
        'waistCM',
        'chestCM',
        'armCM',
        'thighCM',
      ] as const) {
        const v = asNumber(m[k])
        if (v != null) item[k] = v
      }
      metrics.push(item)
    }
    out.bodyMetrics = metrics
  }

  if (raw.chat !== undefined) {
    if (!Array.isArray(raw.chat)) return null
    out.chat = raw.chat.filter(
      (c): c is ChatMessage =>
        isObject(c) && typeof c.id === 'string' && typeof c.role === 'string' && typeof c.content === 'string',
    )
  }

  return out
}

export function importJSON(text: string, data: AppData): { result: ImportResult; data: AppData } {
  const result = emptyResult()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    result.message = 'JSON 解析失败：请检查格式是否符合 schema'
    return { result, data }
  }
  const schema = decodeSchema(parsed)
  if (schema == null) {
    result.message = 'JSON 解析失败：请检查格式是否符合 schema'
    return { result, data }
  }

  const workouts: WorkoutSession[] = [...data.workouts]
  for (const w of schema.workouts ?? []) {
    const date = parseDate(w.date)
    if (date == null) continue
    const exercises: ExerciseEntry[] = (w.exercises ?? []).map((ex) => ({
      id: newID(),
      name: ex.name,
      sets: ex.sets.map((s) => ({ reps: s.reps, weightKG: s.weight_kg })),
      rpe: ex.rpe ?? null,
    }))
    workouts.push({
      id: newID(),
      date,
      splitName: w.split ?? '导入',
      exercises,
      durationMin: w.durationMin ?? 0,
      notes: '',
    })
    result.workouts += 1
  }

  const bodyMetrics: BodyMetric[] = [...data.bodyMetrics]
  for (const m of schema.bodyMetrics ?? []) {
    const date = parseDate(m.date)
    if (date == null) continue
    bodyMetrics.push({
      id: newID(),
      date,
      weightKG: m.weight_kg,
      bodyFatPct: m.bodyFatPct ?? null,
      muscleMassKG: m.muscleMassKG ?? null,
      waistCM: m.waistCM ?? null,
      chestCM: m.chestCM ?? null,
      armCM: m.armCM ?? null,
      thighCM: m.thighCM ?? null,
    })
    result.metrics += 1
  }

  result.chat = schema.chat ?? []
  result.message = `导入完成：训练 ${result.workouts} 条，身体数据 ${result.metrics} 条`
  return { result, data: { ...data, workouts, bodyMetrics } }
}

// MARK: - CSV 导入

/** 自动识别 CSV 是「身体数据」还是「训练记录」 */
export function importCSV(text: string, data: AppData): { result: ImportResult; data: AppData } {
  const result = emptyResult()
  const rows = parseCSV(text)
  if (rows.length === 0) {
    result.message = 'CSV 为空'
    return { result, data }
  }
  const header = rows[0]
  const lower = header.map((h) => h.toLowerCase().trim())
  const col = (name: string): number | null => {
    const i = lower.indexOf(name)
    return i < 0 ? null : i
  }
  const firstOf = (...names: string[]): number | null => {
    for (const n of names) {
      const i = col(n)
      if (i != null) return i
    }
    return null
  }

  const bodyMetrics: BodyMetric[] = [...data.bodyMetrics]
  const workouts: WorkoutSession[] = [...data.workouts]

  if (lower.includes('weight_kg') || lower.includes('weightkg') || lower.includes('体重')) {
    const dateIdx = firstOf('date', '日期') ?? 0
    const weightIdx = firstOf('weight_kg', 'weightkg', '体重') ?? 1
    const fatIdx = firstOf('bodyfatpct', 'body_fat_pct', '体脂')
    const waistIdx = firstOf('waist_cm', '腰围')
    for (const r of rows.slice(1)) {
      if (r.length <= Math.max(dateIdx, weightIdx)) continue
      const date = parseDate(r[dateIdx])
      const w = cellNumber(r[weightIdx])
      if (date == null || w == null) continue
      bodyMetrics.push({
        id: newID(),
        date,
        weightKG: w,
        bodyFatPct: fatIdx != null && r.length > fatIdx ? cellNumber(r[fatIdx]) : null,
        waistCM: waistIdx != null && r.length > waistIdx ? cellNumber(r[waistIdx]) : null,
      })
      result.metrics += 1
    }
  } else if (lower.includes('exercise') || lower.includes('动作')) {
    const dateIdx = firstOf('date', '日期') ?? 0
    const exIdx = firstOf('exercise', '动作') ?? 1
    const repsIdx = firstOf('reps', '次数') ?? 2
    const weightIdx = col('weight_kg') ?? col('重量') ?? 3

    const byDate = new Map<string, ExerciseEntry[]>()
    for (const r of rows.slice(1)) {
      if (r.length <= Math.max(dateIdx, exIdx, repsIdx)) continue
      if (parseDate(r[dateIdx]) == null) continue
      const reps = cellInt(r[repsIdx]) ?? 0
      const weight = weightIdx < r.length ? (cellNumber(r[weightIdx]) ?? 0) : 0
      const key = r[dateIdx]
      const list = byDate.get(key) ?? []
      // 同一天的同一个动作合并到一条，sets 累加
      const existing = list.find((e) => e.name === r[exIdx])
      if (existing != null) {
        existing.sets.push({ reps, weightKG: weight })
      } else {
        list.push({ id: newID(), name: r[exIdx], sets: [{ reps, weightKG: weight }] })
      }
      byDate.set(key, list)
    }
    for (const [key, exercises] of byDate) {
      workouts.push({
        id: newID(),
        date: parseDate(key) ?? new Date(),
        splitName: '导入',
        exercises,
        durationMin: 0,
        notes: '',
      })
      result.workouts += 1
    }
  } else {
    result.message = '无法识别 CSV 类型：请包含 weight_kg（身体数据）或 exercise（训练记录）列'
    return { result, data }
  }

  result.message = `导入完成：训练 ${result.workouts} 条，身体数据 ${result.metrics} 条`
  return { result, data: { ...data, workouts, bodyMetrics } }
}

// MARK: - 完整备份恢复

export type RestoreMode = 'replace' | 'merge'
export type ConflictStrategy = 'local' | 'backup'
export type CollectionKey =
  | 'workouts'
  | 'plannedWorkouts'
  | 'bodyMetrics'
  | 'foods'
  | 'exercises'
  | 'dietLogs'

export interface RestoreIssue {
  path: string
  message: string
}

export interface RestoreCounts {
  workouts: number
  plannedWorkouts: number
  bodyMetrics: number
  foods: number
  exercises: number
  dietLogs: number
  dietEvaluations: number
  chat: number
}

export interface RestorePreview {
  kind: 'full'
  valid: boolean
  sourceVersion: number
  schemaVersion: number
  data: AppData | null
  chat: ChatMessage[]
  presentFields: Set<string>
  counts: RestoreCounts
  skipped: number
  issues: RestoreIssue[]
}

export interface RestoreStats {
  added: number
  updated: number
  ignored: number
  skipped: number
  issues: RestoreIssue[]
}

export interface RestorePlan {
  data: AppData
  chat: ChatMessage[]
  stats: RestoreStats
}

const COLLECTION_KEYS: CollectionKey[] = [
  'workouts',
  'plannedWorkouts',
  'bodyMetrics',
  'foods',
  'exercises',
  'dietLogs',
]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WORKOUT_STATUSES = new Set(['planned', 'completed', 'skipped'])
const DIET_SOURCES = new Set(['manual', 'image'])
const EVALUATION_STATUSES = new Set([
  'insufficient', 'withinRange', 'deviating', 'suggested', 'accepted', 'dismissed',
])

function counts(data: AppData | null, chat: ChatMessage[]): RestoreCounts {
  return {
    workouts: data?.workouts.length ?? 0,
    plannedWorkouts: data?.plannedWorkouts.length ?? 0,
    bodyMetrics: data?.bodyMetrics.length ?? 0,
    foods: data?.foods.length ?? 0,
    exercises: data?.exercises.length ?? 0,
    dietLogs: data?.dietLogs.length ?? 0,
    dietEvaluations: data?.dietCalibration?.evaluations.length ?? 0,
    chat: chat.length,
  }
}

function validUUID(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v)
}

function finite(v: unknown, nonnegative = false): v is number {
  return typeof v === 'number' && Number.isFinite(v) && (!nonnegative || v >= 0)
}

function nonnegativeInteger(v: unknown): v is number {
  return finite(v, true) && Number.isInteger(v)
}

function validDate(v: unknown): v is Date {
  return v instanceof Date && Number.isFinite(v.getTime())
}

const LOCAL_DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

function validLocalDateKey(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const match = LOCAL_DATE_KEY.exec(v)
  if (match == null) return false
  const date = new Date(+match[1], +match[2] - 1, +match[3])
  return date.getFullYear() === +match[1] && date.getMonth() === +match[2] - 1 && date.getDate() === +match[3]
}

function toLocalDateKey(v: unknown): string | null {
  if (validLocalDateKey(v)) return v
  const date = v instanceof Date ? v : typeof v === 'string' ? parseDate(v) : null
  if (date == null) return null
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function optionalFinite(v: unknown, nonnegative = false): boolean {
  return v == null || finite(v, nonnegative)
}

function validProfile(v: unknown): v is UserProfile {
  return (
    isObject(v) &&
    typeof v.sex === 'string' &&
    nonnegativeInteger(v.age) &&
    finite(v.heightCM, true) &&
    finite(v.activityLevel, true) &&
    nonnegativeInteger(v.trainingDaysPerWeek)
  )
}

function validGoal(v: unknown): v is Goal {
  return (
    isObject(v) &&
    (v.type === 'bulk' || v.type === 'cut' || v.type === 'maintain') &&
    finite(v.targetWeightKG, true) &&
    optionalFinite(v.targetBodyFatPct, true) &&
    finite(v.weeklyTargetDeltaKG, true)
  )
}

function validSets(v: unknown): boolean {
  return Array.isArray(v) && v.every((s) => isObject(s) && nonnegativeInteger(s.reps) && finite(s.weightKG, true))
}

function uniqueNestedIDs(v: unknown): boolean {
  if (!Array.isArray(v)) return false
  const ids = v.map((item) => isObject(item) && typeof item.id === 'string' ? item.id.toLowerCase() : '')
  return new Set(ids).size === ids.length
}

function validWorkout(v: unknown): v is WorkoutSession {
  return (
    isObject(v) &&
    validUUID(v.id) &&
    validDate(v.date) &&
    typeof v.splitName === 'string' &&
    finite(v.durationMin, true) &&
    typeof v.notes === 'string' &&
    Array.isArray(v.exercises) &&
    uniqueNestedIDs(v.exercises) &&
    v.exercises.every(
      (e) => isObject(e) && validUUID(e.id) && typeof e.name === 'string' && validSets(e.sets) && optionalFinite(e.rpe),
    )
  )
}

function validPlanned(v: unknown): v is PlannedWorkout {
  return (
    isObject(v) &&
    validUUID(v.id) &&
    validDate(v.date) &&
    typeof v.splitName === 'string' &&
    typeof v.status === 'string' &&
    WORKOUT_STATUSES.has(v.status) &&
    (v.note == null || typeof v.note === 'string') &&
    (v.reminderID == null || typeof v.reminderID === 'string') &&
    Array.isArray(v.exercises) &&
    uniqueNestedIDs(v.exercises) &&
    v.exercises.every(
      (e) =>
        isObject(e) &&
        validUUID(e.id) &&
        typeof e.name === 'string' &&
        nonnegativeInteger(e.targetSets) &&
        nonnegativeInteger(e.targetReps) &&
        finite(e.targetWeightKG, true),
    )
  )
}

function validMetric(v: unknown): v is BodyMetric {
  return (
    isObject(v) &&
    validUUID(v.id) &&
    validDate(v.date) &&
    finite(v.weightKG, true) &&
    ['bodyFatPct', 'muscleMassKG', 'waistCM', 'chestCM', 'armCM', 'thighCM'].every((k) =>
      optionalFinite(v[k], true),
    )
  )
}

function validFood(v: unknown): v is Food {
  return (
    isObject(v) &&
    validUUID(v.id) &&
    typeof v.name === 'string' &&
    finite(v.kcalPer100g, true) &&
    finite(v.proteinPer100g, true) &&
    finite(v.carbPer100g, true) &&
    finite(v.fatPer100g, true)
  )
}

function validExercise(v: unknown): v is ExerciseDef {
  return (
    isObject(v) &&
    validUUID(v.id) &&
    typeof v.name === 'string' &&
    typeof v.muscleGroup === 'string' &&
    typeof v.equipment === 'string' &&
    typeof v.isBodyweight === 'boolean'
  )
}

function validDietLog(v: unknown): v is DietLog {
  return (
    isObject(v) &&
    validUUID(v.id) &&
    validDate(v.date) &&
    typeof v.foodName === 'string' &&
    finite(v.amountG, true) &&
    (v.foodId == null || validUUID(v.foodId)) &&
    ['kcal', 'protein', 'carb', 'fat'].every((k) => optionalFinite(v[k], true)) &&
    (v.source == null || (typeof v.source === 'string' && DIET_SOURCES.has(v.source))) &&
    (v.imageName == null || typeof v.imageName === 'string')
  )
}

function validBigThree(v: unknown): v is BigThreeMax | null {
  return v == null || (isObject(v) && ['benchKG', 'squatKG', 'deadliftKG'].every((k) => optionalFinite(v[k], true)))
}

function validDietEvaluation(v: unknown): v is DietEvaluation {
  return isObject(v) && validUUID(v.id) &&
    ['previousWindowStart', 'previousWindowEnd', 'currentWindowStart', 'currentWindowEnd']
      .every((key) => validLocalDateKey(v[key])) &&
    validDate(v.createdAt) &&
    (v.decidedAt == null || validDate(v.decidedAt)) &&
    ['previousAverageKG', 'currentAverageKG', 'days', 'actualWeeklyDelta', 'deviation',
      'suggestedAdjustmentKcal', 'appliedAdjustmentKcal', 'weeklyTargetDeltaKG']
      .every((key) => finite(v[key])) &&
    nonnegativeInteger(v.previousPointCount) && nonnegativeInteger(v.currentPointCount) &&
    (v.goalType === 'bulk' || v.goalType === 'cut' || v.goalType === 'maintain') &&
    typeof v.status === 'string' && EVALUATION_STATUSES.has(v.status)
}

function validChat(v: unknown): v is ChatMessage {
  return (
    isObject(v) &&
    validUUID(v.id) &&
    typeof v.role === 'string' &&
    typeof v.content === 'string' &&
    (v.proposal == null || typeof v.proposal === 'string') &&
    (v.proposalStatus == null || typeof v.proposalStatus === 'string') &&
    (v.proposalResult == null || (Array.isArray(v.proposalResult) && v.proposalResult.every((item) => typeof item === 'string')))
  )
}

const validators: Record<CollectionKey, (v: unknown) => boolean> = {
  workouts: validWorkout,
  plannedWorkouts: validPlanned,
  bodyMetrics: validMetric,
  foods: validFood,
  exercises: validExercise,
  dietLogs: validDietLog,
}

function validatedArray<T>(
  raw: unknown,
  key: CollectionKey | 'chat' | 'dietEvaluations',
  validate: (v: unknown) => boolean,
  issues: RestoreIssue[],
): T[] | null {
  if (!Array.isArray(raw)) {
    issues.push({ path: key, message: '必须是数组' })
    return null
  }
  const out: T[] = []
  const ids = new Set<string>()
  raw.forEach((item, index) => {
    let candidate = item
    if (isObject(item)) {
      candidate = { ...item }
      if (key === 'workouts' && !Object.hasOwn(item, 'notes')) candidate.notes = ''
      if (key === 'plannedWorkouts' && !Object.hasOwn(item, 'status')) candidate.status = 'planned'
      if (key === 'exercises' && !Object.hasOwn(item, 'isBodyweight')) candidate.isBodyweight = false
      if (key === 'dietEvaluations') {
        candidate.previousWindowStart = toLocalDateKey(item.previousWindowStart ?? item.earliestWindowStart)
        candidate.previousWindowEnd = toLocalDateKey(item.previousWindowEnd ?? item.earliestWindowEnd)
        candidate.currentWindowStart = toLocalDateKey(item.currentWindowStart ?? item.latestWindowStart)
        candidate.currentWindowEnd = toLocalDateKey(item.currentWindowEnd ?? item.latestWindowEnd)
        candidate.weeklyTargetDeltaKG = item.weeklyTargetDeltaKG ?? item.targetWeeklyDeltaKG
        candidate.actualWeeklyDelta = item.actualWeeklyDelta ?? item.actualWeeklyDeltaKG
        candidate.deviation = item.deviation ?? item.deviationKGPerWeek
        delete candidate.earliestWindowStart
        delete candidate.earliestWindowEnd
        delete candidate.latestWindowStart
        delete candidate.latestWindowEnd
        delete candidate.targetWeeklyDeltaKG
        delete candidate.actualWeeklyDeltaKG
        delete candidate.deviationKGPerWeek
      }
    }
    if (!validate(candidate)) {
      issues.push({ path: `${key}[${index}]`, message: '字段、UUID、日期、枚举或数值无效，已跳过' })
      return
    }
    const id = (candidate as { id: string }).id.toLowerCase()
    if (ids.has(id)) {
      issues.push({ path: `${key}[${index}]`, message: `重复 id ${id}，已跳过` })
      return
    }
    ids.add(id)
    const normalized = { ...candidate, id } as Record<string, unknown>
    if ((key === 'workouts' || key === 'plannedWorkouts') && Array.isArray(normalized.exercises)) {
      normalized.exercises = normalized.exercises.map((exercise) => ({
        ...exercise as Record<string, unknown>,
        id: (exercise as { id: string }).id.toLowerCase(),
      }))
    }
    if (key === 'dietLogs' && typeof normalized.foodId === 'string') normalized.foodId = normalized.foodId.toLowerCase()
    out.push(normalized as T)
  })
  return out
}

/** 纯解析、迁移和验证；不会读取或修改 Store。 */
export function previewFullBackup(text: string): RestorePreview | null {
  let raw: unknown
  try {
    raw = decodeJSON<unknown>(text)
  } catch {
    return null
  }
  if (!isObject(raw)) return null
  const presentFields = new Set(Object.keys(raw))
  const appDataMarkers = [...COLLECTION_KEYS, 'bigThree', 'coachNotes', 'createdAt', 'updatedAt']
  if (!presentFields.has('schemaVersion') &&
      !(presentFields.has('profile') && presentFields.has('goal') && appDataMarkers.some((key) => presentFields.has(key)))) {
    return null
  }

  const issues: RestoreIssue[] = []
  const sourceVersion = raw.schemaVersion == null ? 1 : asNumber(raw.schemaVersion)
  if (sourceVersion == null || !Number.isInteger(sourceVersion) || sourceVersion < 1) {
    issues.push({ path: 'schemaVersion', message: 'schemaVersion 必须是正整数' })
  } else if (sourceVersion > CURRENT_SCHEMA_VERSION) {
    issues.push({ path: 'schemaVersion', message: `备份版本 v${sourceVersion} 高于当前支持的 v${CURRENT_SCHEMA_VERSION}` })
  }
  if (!validProfile(raw.profile)) issues.push({ path: 'profile', message: '关键配置缺失或无效，不能静默使用默认值' })
  if (!validGoal(raw.goal)) issues.push({ path: 'goal', message: '关键配置缺失或无效，不能静默使用默认值' })
  if (!validBigThree(raw.bigThree)) issues.push({ path: 'bigThree', message: '三大项配置无效' })
  if (raw.coachNotes != null && (!Array.isArray(raw.coachNotes) || !raw.coachNotes.every((v) => typeof v === 'string'))) {
    issues.push({ path: 'coachNotes', message: '长期偏好必须是字符串数组' })
  }
  for (const field of ['createdAt', 'updatedAt'] as const) {
    if (raw[field] != null && !validDate(raw[field])) issues.push({ path: field, message: '日期无效' })
  }

  const collections: Partial<Record<CollectionKey, unknown[]>> = {}
  for (const key of COLLECTION_KEYS) {
    if (!presentFields.has(key)) {
      collections[key] = key === 'foods' ? [...SEED_FOODS] : key === 'exercises' ? [...SEED_EXERCISES] : []
      continue
    }
    const value = validatedArray(raw[key], key, validators[key], issues)
    if (value != null) collections[key] = value
  }
  let dietCalibration: DietCalibration = { currentAdjustmentKcal: 0, evaluations: [] }
  if (raw.dietCalibration != null) {
    if (!isObject(raw.dietCalibration) || !finite(raw.dietCalibration.currentAdjustmentKcal)) {
      issues.push({ path: 'dietCalibration', message: '校准配置无效' })
    } else if (Math.abs(raw.dietCalibration.currentAdjustmentKcal) > 700) {
      issues.push({ path: 'dietCalibration', message: 'currentAdjustmentKcal 超出 [-700, 700]' })
    } else {
      const evaluations = validatedArray<DietEvaluation>(
        raw.dietCalibration.evaluations,
        'dietEvaluations',
        validDietEvaluation,
        issues,
      )
      if (evaluations != null) {
        dietCalibration = {
          currentAdjustmentKcal: raw.dietCalibration.currentAdjustmentKcal,
          evaluations,
        }
      }
    }
  }
  const chat = raw.chat == null ? [] : (validatedArray<ChatMessage>(raw.chat, 'chat', validChat, issues) ?? [])
  const critical = issues.some((issue) =>
    ['schemaVersion', 'profile', 'goal', 'bigThree', 'coachNotes', 'createdAt', 'updatedAt', 'chat', 'dietCalibration'].includes(issue.path) ||
    (COLLECTION_KEYS as string[]).includes(issue.path),
  )
  const skipped = issues.filter((issue) => /\[\d+\]/.test(issue.path)).length
  const data = critical
    ? null
    : ({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        createdAt: raw.createdAt as Date | null | undefined,
        updatedAt: raw.updatedAt as Date | null | undefined,
        profile: raw.profile as UserProfile,
        goal: raw.goal as Goal,
        workouts: collections.workouts as WorkoutSession[],
        plannedWorkouts: collections.plannedWorkouts as PlannedWorkout[],
        bodyMetrics: collections.bodyMetrics as BodyMetric[],
        foods: collections.foods as Food[],
        exercises: collections.exercises as ExerciseDef[],
        dietLogs: collections.dietLogs as DietLog[],
        dietCalibration,
        bigThree: (raw.bigThree ?? null) as BigThreeMax | null,
        coachNotes: (raw.coachNotes ?? null) as string[] | null,
      } satisfies AppData)
  return {
    kind: 'full',
    valid: data != null,
    sourceVersion: sourceVersion ?? 0,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    data,
    chat,
    presentFields,
    counts: counts(data, chat),
    skipped,
    issues,
  }
}

function equalValue(a: unknown, b: unknown): boolean {
  return encodeJSON(a) === encodeJSON(b)
}

function mergeByID<T extends { id: string }>(
  local: T[],
  backup: T[],
  strategy: ConflictStrategy,
  stats: RestoreStats,
): T[] {
  const out: T[] = []
  const indexes = new Map<string, number>()
  for (const item of local) {
    const id = item.id.toLowerCase()
    if (indexes.has(id)) {
      stats.ignored++
      continue
    }
    indexes.set(id, out.length)
    out.push(item)
  }
  for (const item of backup) {
    const id = item.id.toLowerCase()
    const index = indexes.get(id)
    if (index == null) {
      indexes.set(id, out.length)
      out.push(item)
      stats.added++
    } else if (equalValue(out[index], item)) {
      stats.ignored++
    } else if (strategy === 'backup') {
      out[index] = item
      stats.updated++
    } else {
      stats.ignored++
    }
  }
  return out
}

function mergeSingle<T>(local: T, backup: T, present: boolean, strategy: ConflictStrategy, stats: RestoreStats): T {
  if (!present || equalValue(local, backup)) {
    stats.ignored++
    return local
  }
  if (strategy === 'backup') {
    stats.updated++
    return backup
  }
  stats.ignored++
  return local
}

/** 从预览生成确定的替换/合并结果；不产生副作用。 */
export function planFullRestore(
  preview: RestorePreview,
  localData: AppData,
  localChat: ChatMessage[],
  mode: RestoreMode,
  strategy: ConflictStrategy,
): RestorePlan {
  if (!preview.valid || preview.data == null) throw new Error('完整备份未通过验证')
  const stats: RestoreStats = {
    added: 0,
    updated: 0,
    ignored: 0,
    skipped: preview.skipped,
    issues: preview.issues,
  }
  if (mode === 'replace') {
    stats.added = Object.values(preview.counts).reduce((sum, value) => sum + value, 0)
    return { data: preview.data, chat: preview.chat, stats }
  }
  const merged = { ...localData, schemaVersion: CURRENT_SCHEMA_VERSION }
  for (const key of COLLECTION_KEYS) {
    ;(merged[key] as { id: string }[]) = mergeByID(
      localData[key] as { id: string }[],
      preview.data[key] as { id: string }[],
      strategy,
      stats,
    )
  }
  merged.profile = mergeSingle(localData.profile, preview.data.profile, preview.presentFields.has('profile'), strategy, stats)
  merged.goal = mergeSingle(localData.goal, preview.data.goal, preview.presentFields.has('goal'), strategy, stats)
  merged.bigThree = mergeSingle(localData.bigThree, preview.data.bigThree, preview.presentFields.has('bigThree'), strategy, stats)
  merged.coachNotes = mergeSingle(localData.coachNotes, preview.data.coachNotes, preview.presentFields.has('coachNotes'), strategy, stats)
  const localCalibration = localData.dietCalibration ?? { currentAdjustmentKcal: 0, evaluations: [] }
  const backupCalibration = preview.data.dietCalibration ?? { currentAdjustmentKcal: 0, evaluations: [] }
  merged.dietCalibration = {
    currentAdjustmentKcal: mergeSingle(
      localCalibration.currentAdjustmentKcal,
      backupCalibration.currentAdjustmentKcal,
      preview.presentFields.has('dietCalibration'),
      strategy,
      stats,
    ),
    evaluations: mergeByID(localCalibration.evaluations, backupCalibration.evaluations, strategy, stats),
  }
  merged.createdAt = localData.createdAt ?? preview.data.createdAt
  merged.updatedAt = preview.data.updatedAt ?? localData.updatedAt
  const chat = mergeByID(localChat, preview.chat, strategy, stats)
  return { data: merged, chat, stats }
}

export const Importer = {
  importJSON,
  importCSV,
  parseDate,
  parseCSV,
  previewFullBackup,
  planFullRestore,
}