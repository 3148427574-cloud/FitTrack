// 对应 Mac 版 Sources/FitTrack/Importer.swift。
//
// 对外统一契约：`weight_kg`（对外 schema）与 `weightKG`（App 自己导出的驼峰）都要接受，
// 否则「导出 JSON」产出的备份根本导不回来（2026-09-20 踩过）。
//
// 与 Mac 版的差异：Swift 用 `inout AppData` 原地追加，TS 没有 inout，
// 所以返回追加后的新对象，页面拿它调 store.replaceData()。

import {
  newID,
  type AppData,
  type BodyMetric,
  type ChatMessage,
  type ExerciseEntry,
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

export const Importer = { importJSON, importCSV, parseDate, parseCSV }