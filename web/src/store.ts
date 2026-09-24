// 对应 Mac 版 Sources/FitTrack/AppStore.swift。
// 两个文件（fittrack.json / chat.json）换成两个 localStorage 键 —— 存的是同一份 JSON 结构，
// 所以 Mac 版导出的文件能原样导入，这里导出的也能被 Mac 版读回。
//
// 与 Mac 版的差异：API Key 也睡在 localStorage（浏览器里没有 Keychain 的等价物）。

import type { RestorePlan, RestoreStats } from './importer'
import {
  BIG_THREE_LABELS,
  BIG_THREE_LIFTS,
  StrengthModel,
  bigThreeSet,
  bigThreeValue,
  dailyCalorieAdjustment,
  fmt0,
  fmt1,
  fmt2,
  isBodyweight,
  weightText,
  type BigThreeLift,
} from './engine'
import {
  CURRENT_SCHEMA_VERSION,
  GOAL_LABELS,
  SEED_EXERCISES,
  SEED_FOODS,
  decodeJSON,
  emptyAppData,
  encodeJSON,
  newID,
  type AIUpdatePayload,
  type AppData,
  type BigThreeMax,
  type BodyMetric,
  type ChatMessage,
  type DietEvaluation,
  type DietLog,
  type ExerciseEntry,
  type Goal,
  type GoalType,
  type PlanPatch,
  type PlannedExercise,
  type PlannedExercisePatch,
  type PlannedWorkout,
  type SetEntry,
  type UserProfile,
  type WorkoutSession,
  type WorkoutStatus,
} from './models'

const DATA_KEY = 'fittrack.data'
const CHAT_KEY = 'fittrack.chat'
const BACKUP_KEY = 'fittrack.restoreBackup'
const API_KEY_KEY = 'fittrack.apiKey'
const MAX_CHAT = 40 // 与 Mac 版 Views.swift 的 maxHistory 一致

// MARK: - localStorage 读写

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function remove(key: string): boolean {
  try {
    localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

/**
 * 把解析出来的原始对象补成完整 AppData。
 *
 * Mac 版用 Codable 直接解，缺一个非 optional 字段就整体解码失败 → 退回空数据（等于丢数据）。
 * 网页版这里刻意更稳：缺什么用默认值补什么，坏字段不牵连整份备份。
 */
function normalizeData(raw: unknown): AppData {
  const base = emptyAppData()
  if (raw == null || typeof raw !== 'object') return base
  const r = raw as Record<string, any>
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  return {
    schemaVersion: typeof r.schemaVersion === 'number' ? r.schemaVersion : CURRENT_SCHEMA_VERSION,
    createdAt: r.createdAt ?? null,
    updatedAt: r.updatedAt ?? null,
    profile: { ...base.profile, ...(r.profile ?? {}) },
    goal: { ...base.goal, ...(r.goal ?? {}) },
    workouts: arr<WorkoutSession>(r.workouts),
    plannedWorkouts: arr<PlannedWorkout>(r.plannedWorkouts),
    bodyMetrics: arr<BodyMetric>(r.bodyMetrics),
    foods: arr(r.foods),
    exercises: arr(r.exercises),
    dietLogs: arr(r.dietLogs),
    dietCalibration: {
      currentAdjustmentKcal: typeof r.dietCalibration?.currentAdjustmentKcal === 'number'
        ? r.dietCalibration.currentAdjustmentKcal
        : 0,
      evaluations: arr<DietEvaluation>(r.dietCalibration?.evaluations),
    },
    bigThree: r.bigThree ?? null,
    coachNotes: r.coachNotes ?? null,
  }
}

// MARK: - 范围夹紧（对应 Swift 的 Comparable.clamped(to:)）

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

/** Swift 的 `(x * 10).rounded() / 10`：就近远离零，保留一位小数 */
function round1(v: number): number {
  return Math.round(v * 10) / 10
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** Swift 的 plannedChanges 里那个 fmt：整数不带小数位，否则一位 */
function fmtNum(v: number): string {
  return Number.isInteger(v) ? fmt0(v) : fmt1(v)
}

// MARK: - 仓库

class AppStore {
  data: AppData
  chatMessages: ChatMessage[]
  apiKey: string

  private listeners = new Set<() => void>()

  constructor() {
    const rawData = read(DATA_KEY)
    const parsed = rawData == null ? null : safeParse(rawData)
    const loaded = parsed == null ? emptyAppData() : normalizeData(parsed)
    // 仅真正首次运行补种子；已明确保存 [] 表示用户要空库。
    if (rawData == null) {
      loaded.exercises = SEED_EXERCISES
      loaded.foods = SEED_FOODS
    }
    this.data = loaded

    const rawChat = read(CHAT_KEY)
    const parsedChat = rawChat == null ? null : safeParse(rawChat)
    this.chatMessages = Array.isArray(parsedChat) ? (parsedChat as ChatMessage[]) : []
    this.apiKey = read(API_KEY_KEY) ?? ''
  }

  // MARK: 订阅（给 React 的 useSyncExternalStore 用）
  //
  // 快照必须是稳定引用，所以每次改动都换新对象（不可变更新），不原地改。

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getData = (): AppData => this.data
  getChat = (): ChatMessage[] => this.chatMessages

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  // MARK: 持久化

  private save(): void {
    write(DATA_KEY, encodeJSON(this.data))
  }

  private saveChat(): void {
    write(CHAT_KEY, encodeJSON(this.chatMessages))
  }

  /** 数据改动统一走这里：换引用 → 通知 → 落盘 */
  private commit(next: AppData): void {
    this.data = next
    this.emit()
    this.save()
  }

  setApiKey(key: string): void {
    this.apiKey = key
    write(API_KEY_KEY, key)
    this.emit()
  }

  // MARK: 聊天

  appendChat(m: ChatMessage): void {
    this.chatMessages = [...this.chatMessages, m]
    this.emit()
    this.saveChat()
  }

  replaceChat(messages: ChatMessage[]): void {
    this.chatMessages = messages
    this.emit()
    this.saveChat()
  }

  trimChat(max: number): void {
    if (this.chatMessages.length <= max) return
    this.chatMessages = this.chatMessages.slice(-max)
    this.emit()
    this.saveChat()
  }

  clearChat(): void {
    if (this.chatMessages.length === 0) return
    this.chatMessages = []
    this.emit()
    this.saveChat()
  }

  /** 合并导入的聊天记录：按 id 去重后追加，返回新增条数 */
  importChat(incoming: ChatMessage[]): number {
    const existing = new Set(this.chatMessages.map((m) => m.id))
    const fresh = incoming.filter((m) => !existing.has(m.id))
    if (fresh.length === 0) return 0
    this.chatMessages = [...this.chatMessages, ...fresh]
    this.emit()
    this.saveChat()
    return fresh.length
  }

  // MARK: AI 提议

  /** 应用挂在某条聊天消息上的待确认变更 */
  applyProposal(messageID: string): string[] {
    const idx = this.chatMessages.findIndex((m) => m.id === messageID)
    if (idx < 0) return []
    const json = this.chatMessages[idx].proposal
    if (json == null) return []
    const payload = AppStore.decodePayload(json)
    if (payload == null) return []
    const changes = this.applyUpdate(payload)
    const next = [...this.chatMessages]
    next[idx] = { ...next[idx], proposalResult: changes, proposalStatus: 'applied' }
    this.chatMessages = next
    this.emit()
    this.saveChat()
    return changes
  }

  setProposalStatus(messageID: string, status: string): void {
    const idx = this.chatMessages.findIndex((m) => m.id === messageID)
    if (idx < 0) return
    if ((this.chatMessages[idx].proposalStatus ?? '') === status) return
    const next = [...this.chatMessages]
    next[idx] = { ...next[idx], proposalStatus: status }
    this.chatMessages = next
    this.emit()
    this.saveChat()
  }

  applyUpdate(payload: AIUpdatePayload): string[] {
    const { changes, updated } = AppStore.plannedChanges(payload, this.data)
    if (changes.length > 0) this.commit(updated)
    return changes
  }

  /**
   * 纯函数版：逐字段白名单校验 + 范围夹紧，返回变更摘要与改好的数据副本。
   * 聊天里的确认卡片用它做预览，点「应用」时走同一个函数，保证预览与落地一致。
   *
   * `now` 只影响「今日计划」变更挑哪一天的计划；默认取当前时间。
   */
  static plannedChanges(
    payload: AIUpdatePayload,
    data: AppData,
    now: Date = new Date(),
  ): { changes: string[]; updated: AppData } {
    const out: AppData = {
      ...data,
      profile: { ...data.profile },
      goal: { ...data.goal },
    }
    const changes: string[] = []

    const p = payload.profile
    if (p != null) {
      if (p.sex != null) {
        const v = normalizeSex(p.sex)
        if (v != null && v !== out.profile.sex) {
          changes.push(`性别：${sexLabel(out.profile.sex)} → ${sexLabel(v)}`)
          out.profile.sex = v
        }
      }
      if (p.age != null) {
        const v = clamp(p.age, 10, 90)
        if (v !== out.profile.age) {
          changes.push(`年龄：${out.profile.age} → ${v}`)
          out.profile.age = v
        }
      }
      if (p.heightCM != null) {
        const v = round1(clamp(p.heightCM, 120, 250))
        if (Math.abs(v - out.profile.heightCM) > 0.05) {
          changes.push(`身高：${fmtNum(out.profile.heightCM)}cm → ${fmtNum(v)}cm`)
          out.profile.heightCM = v
        }
      }
      if (p.activityLevel != null) {
        const v = snapActivityLevel(p.activityLevel)
        if (v != null && Math.abs(v - out.profile.activityLevel) > 0.001) {
          changes.push(`活动系数：${fmtNum(out.profile.activityLevel)} → ${fmtNum(v)}`)
          out.profile.activityLevel = v
        }
      }
      if (p.trainingDaysPerWeek != null) {
        const v = clamp(p.trainingDaysPerWeek, 1, 7)
        if (v !== out.profile.trainingDaysPerWeek) {
          changes.push(`每周训练天数：${out.profile.trainingDaysPerWeek} → ${v}`)
          out.profile.trainingDaysPerWeek = v
        }
      }
    }

    const g = payload.goal
    if (g != null) {
      if (g.type != null) {
        const v = normalizeGoalType(g.type)
        if (v != null && v !== out.goal.type) {
          changes.push(`目标类型：${GOAL_LABELS[out.goal.type]} → ${GOAL_LABELS[v]}`)
          out.goal.type = v
        }
      }
      if (g.targetWeightKG != null) {
        const v = round1(clamp(g.targetWeightKG, 30, 200))
        if (Math.abs(v - out.goal.targetWeightKG) > 0.05) {
          changes.push(
            `目标体重：${fmtNum(out.goal.targetWeightKG)}kg → ${fmtNum(v)}kg`,
          )
          out.goal.targetWeightKG = v
        }
      }
      if (g.targetBodyFatPct != null) {
        const v = round1(clamp(g.targetBodyFatPct, 3, 60))
        const old = out.goal.targetBodyFatPct
        if (Math.abs(v - (old ?? -1)) > 0.05) {
          const oldLabel = old == null ? '未设置' : `${fmtNum(old)}%`
          changes.push(`目标体脂：${oldLabel} → ${fmtNum(v)}%`)
          out.goal.targetBodyFatPct = v
        }
      }
      if (g.weeklyTargetDeltaKG != null) {
        const v = round2(clamp(g.weeklyTargetDeltaKG, 0, 1))
        if (Math.abs(v - out.goal.weeklyTargetDeltaKG) > 0.005) {
          changes.push(
            `每周增减：${fmt2(out.goal.weeklyTargetDeltaKG)}kg → ${fmt2(v)}kg`,
          )
          out.goal.weeklyTargetDeltaKG = v
        }
      }
    }

    const b = payload.bigThree
    if (b != null) {
      const m: BigThreeMax = { ...(out.bigThree ?? {}) }
      const proposed: Record<BigThreeLift, number | null | undefined> = {
        bench: b.benchKG,
        squat: b.squatKG,
        deadlift: b.deadliftKG,
      }
      for (const lift of BIG_THREE_LIFTS) {
        const raw = proposed[lift]
        if (raw == null) continue
        const v = StrengthModel.roundToPlate(clamp(raw, 20, 400))
        const old = bigThreeValue(m, lift)
        if (old != null && Math.abs(old - v) < 0.01) continue
        const oldLabel = old == null ? '未设置' : `${fmtNum(old)}kg`
        changes.push(`${BIG_THREE_LABELS[lift]}极限：${oldLabel} → ${fmtNum(v)}kg`)
        bigThreeSet(m, lift, v)
      }
      out.bigThree = m
    }

    const incoming = payload.notes
    if (incoming != null) {
      const notes = [...(out.coachNotes ?? [])]
      for (const raw of incoming) {
        const note = String(raw).trim().slice(0, 200)
        if (note === '' || notes.includes(note) || notes.length >= 12) continue
        notes.push(note)
        changes.push(`新增训练偏好：${note}`)
      }
      if (notes.length > 0) out.coachNotes = notes
    }

    // 今日计划变更（网页版新增，Mac 版没有）：只有真的改到东西才替换数组
    const plan = payload.plan
    if (plan != null) {
      const r = applyPlanPatch(plan, out, now)
      if (r.workouts != null) {
        out.plannedWorkouts = r.workouts
        changes.push(...r.changes)
      }
    }

    return { changes, updated: out }
  }

  /**
   * 解析 AI 附的 `<<<UPDATES>>>` 载荷。
   *
   * 与 Mac 版的一处差异：Swift 是整体 `JSONDecoder().decode`，任一字段类型不对就整包丢掉；
   * 这里逐字段降级 —— 坏字段忽略，其余照常应用（每个字段本来就要过夹紧，不会越界）。
   */
  static decodePayload(json: string): AIUpdatePayload | null {
    const raw = safeParse(json)
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null
    const r = raw as Record<string, any>
    const out: AIUpdatePayload = {}
    const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null)
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

    if (isObject(r.profile)) {
      const x = r.profile
      out.profile = {
        sex: str(x.sex),
        age: num(x.age),
        heightCM: num(x.heightCM),
        activityLevel: num(x.activityLevel),
        trainingDaysPerWeek: num(x.trainingDaysPerWeek),
      }
    }
    if (isObject(r.goal)) {
      const x = r.goal
      out.goal = {
        type: str(x.type),
        targetWeightKG: num(x.targetWeightKG),
        targetBodyFatPct: num(x.targetBodyFatPct),
        weeklyTargetDeltaKG: num(x.weeklyTargetDeltaKG),
      }
    }
    if (isObject(r.bigThree)) {
      const x = r.bigThree
      out.bigThree = {
        benchKG: num(x.benchKG),
        squatKG: num(x.squatKG),
        deadliftKG: num(x.deadliftKG),
      }
    }
    if (isObject(r.plan)) {
      const x = r.plan
      out.plan = {
        splitName: str(x.splitName),
        exercises: Array.isArray(x.exercises)
          ? x.exercises
              .filter(isObject)
              .map((e) => ({
                name: str(e.name) ?? '',
                targetSets: num(e.targetSets),
                targetReps: num(e.targetReps),
                targetWeightKG: num(e.targetWeightKG),
              }))
              .filter((e) => e.name.trim() !== '')
          : null,
      }
    }
    if (Array.isArray(r.notes)) {
      out.notes = r.notes.filter((n: unknown) => typeof n === 'string')
    }
    out.reason = str(r.reason)
    return out
  }

  // MARK: - 数据改动（页面调用的入口）
  //
  // Mac 版的页面直接 `store.data.x.append(...)` 再 `store.save()`；网页版数据不可变，
  // 页面统一走这些方法，由 commit 负责「换引用 → 通知 → 落盘」。

  updateProfile(patch: Partial<UserProfile>): void {
    this.commit({ ...this.data, profile: { ...this.data.profile, ...patch } })
  }

  updateGoal(patch: Partial<Goal>): void {
    this.commit({ ...this.data, goal: { ...this.data.goal, ...patch } })
  }

  setBigThree(m: BigThreeMax | null): void {
    this.commit({ ...this.data, bigThree: m })
  }

  /** 追加长期偏好；空白或已存在则不动，返回是否写入（对齐 Swift 的 addNote） */
  addCoachNote(note: string): boolean {
    const trimmed = note.trim()
    if (trimmed === '') return false
    const notes = this.data.coachNotes ?? []
    if (notes.includes(trimmed)) return false
    this.commit({ ...this.data, coachNotes: [...notes, trimmed] })
    return true
  }

  removeCoachNote(index: number): void {
    const notes = this.data.coachNotes
    if (notes == null || index < 0 || index >= notes.length) return
    const next = notes.filter((_, i) => i !== index)
    this.commit({ ...this.data, coachNotes: next.length === 0 ? null : next })
  }

  addWorkout(w: WorkoutSession): void {
    this.commit({ ...this.data, workouts: [...this.data.workouts, w] })
  }

  /** 同日同拆分且仍待完成视为重复，返回 false 不写入（对齐 Views.swift 的 exists 判断） */
  addPlannedWorkout(w: PlannedWorkout): boolean {
    const exists = this.data.plannedWorkouts.some(
      (x) => sameDay(x.date, w.date) && x.splitName === w.splitName && x.status === 'planned',
    )
    if (exists) return false
    this.commit({ ...this.data, plannedWorkouts: [...this.data.plannedWorkouts, w] })
    return true
  }

  /** 幂等：仅 planned 才动，并落成一条训练历史（对齐 Views.swift 的 finishLocally） */
  completePlannedWorkout(id: string): boolean {
    const plan = this.data.plannedWorkouts.find((w) => w.id === id)
    if (plan == null || plan.status !== 'planned') return false
    const plannedWorkouts: PlannedWorkout[] = this.data.plannedWorkouts.map((w) =>
      w.id === id ? { ...w, status: 'completed' as WorkoutStatus } : w,
    )
    const exercises: ExerciseEntry[] = plan.exercises.map((ex) => {
      const sets: SetEntry[] = Array.from({ length: Math.max(1, ex.targetSets) }, () => ({
        reps: ex.targetReps,
        weightKG: ex.targetWeightKG,
      }))
      return { id: newID(), name: ex.name, sets }
    })
    const session: WorkoutSession = {
      id: newID(),
      date: plan.date,
      splitName: plan.splitName,
      exercises,
      durationMin: 60,
      notes: '',
    }
    this.commit({
      ...this.data,
      plannedWorkouts,
      workouts: [...this.data.workouts, session],
    })
    return true
  }

  /** 手动编辑计划（网页版新增：计划卡片上的「编辑」面板保存时调用） */
  updatePlannedWorkout(id: string, patch: Partial<PlannedWorkout>): boolean {
    const idx = this.data.plannedWorkouts.findIndex((w) => w.id === id)
    if (idx < 0) return false
    const plannedWorkouts = [...this.data.plannedWorkouts]
    plannedWorkouts[idx] = { ...plannedWorkouts[idx], ...patch }
    this.commit({ ...this.data, plannedWorkouts })
    return true
  }

  skipPlannedWorkout(id: string): void {
    const plan = this.data.plannedWorkouts.find((w) => w.id === id)
    if (plan == null || plan.status !== 'planned') return
    this.commit({
      ...this.data,
      plannedWorkouts: this.data.plannedWorkouts.map((w) =>
        w.id === id ? { ...w, status: 'skipped' as WorkoutStatus } : w,
      ),
    })
  }

  addBodyMetric(m: BodyMetric): void {
    this.commit({ ...this.data, bodyMetrics: [...this.data.bodyMetrics, m] })
  }

  addDietLog(l: DietLog): void {
    this.commit({ ...this.data, dietLogs: [...this.data.dietLogs, l] })
  }

  recordEvaluation(evaluation: DietEvaluation): boolean {
    const calibration = this.data.dietCalibration ?? { currentAdjustmentKcal: 0, evaluations: [] }
    if (calibration.evaluations.some((item) =>
      item.id === evaluation.id ||
      (item.currentWindowEnd === evaluation.currentWindowEnd &&
        item.goalType === evaluation.goalType &&
        item.weeklyTargetDeltaKG === evaluation.weeklyTargetDeltaKG),
    )) return false
    this.commit({
      ...this.data,
      dietCalibration: {
        ...calibration,
        evaluations: [...calibration.evaluations, evaluation],
      },
    })
    return true
  }

  acceptCalibrationSuggestion(id: string, decidedAt = new Date()): boolean {
    const calibration = this.data.dietCalibration ?? { currentAdjustmentKcal: 0, evaluations: [] }
    const evaluation = calibration.evaluations.find((item) => item.id === id)
    if (evaluation == null || evaluation.status !== 'suggested') return false
    const baseAdjustment = dailyCalorieAdjustment(this.data.goal)
    const currentTotal = baseAdjustment + calibration.currentAdjustmentKcal
    const nextTotal = clamp(currentTotal + evaluation.suggestedAdjustmentKcal, -700, 700)
    const applied = nextTotal - currentTotal
    if (Math.abs(applied) < 100) return false
    const nextAdjustment = calibration.currentAdjustmentKcal + applied
    const evaluations = calibration.evaluations.map((item) => item.id === id
      ? { ...item, status: 'accepted' as const, appliedAdjustmentKcal: applied, decidedAt }
      : item)
    this.commit({
      ...this.data,
      dietCalibration: { currentAdjustmentKcal: nextAdjustment, evaluations },
    })
    return true
  }

  dismissSuggestion(id: string, decidedAt = new Date()): boolean {
    const calibration = this.data.dietCalibration ?? { currentAdjustmentKcal: 0, evaluations: [] }
    const evaluation = calibration.evaluations.find((item) => item.id === id)
    if (evaluation == null || evaluation.status !== 'suggested') return false
    this.commit({
      ...this.data,
      dietCalibration: {
        ...calibration,
        evaluations: calibration.evaluations.map((item) => item.id === id
          ? { ...item, status: 'dismissed' as const, decidedAt }
          : item),
      },
    })
    return true
  }

  deleteDietLog(id: string): void {
    const dietLogs = this.data.dietLogs.filter((log) => log.id !== id)
    if (dietLogs.length === this.data.dietLogs.length) return
    this.commit({ ...this.data, dietLogs })
  }

  /** 待完成的计划，按日期升序（训练页与导出 .ics 共用） */
  upcomingPlanned(): PlannedWorkout[] {
    return this.data.plannedWorkouts
      .filter((w) => w.status === 'planned')
      .sort((a, b) => a.date.getTime() - b.date.getTime())
  }

  // MARK: - 训练历史

  clearWorkouts(): void {
    if (this.data.workouts.length === 0) return
    this.commit({ ...this.data, workouts: [] })
  }

  deleteWorkout(id: string): void {
    const workouts = this.data.workouts.filter((w) => w.id !== id)
    if (workouts.length === this.data.workouts.length) return
    this.commit({ ...this.data, workouts })
  }

  // MARK: 查询辅助

  get latestWeight(): number | null {
    const sorted = this.sortedMetrics
    return sorted.length === 0 ? null : sorted[sorted.length - 1].weightKG
  }

  /** 估算卡路里与配重统一取这个体重：没有身体记录时退回目标体重 */
  get currentBodyWeightKG(): number {
    return this.latestWeight ?? this.data.goal.targetWeightKG
  }

  get sortedMetrics(): BodyMetric[] {
    return [...this.data.bodyMetrics].sort((a, b) => a.date.getTime() - b.date.getTime())
  }

  get sortedWorkouts(): WorkoutSession[] {
    return [...this.data.workouts].sort((a, b) => b.date.getTime() - a.date.getTime())
  }

  planned(on: Date): PlannedWorkout[] {
    return this.data.plannedWorkouts.filter((w) => sameDay(w.date, on))
  }

  // MARK: 导入导出

  /**
   * 导出为 `AppData` 原样展开 + 一个 `chat` 键（聊天历史）。
   * 保持 AppData 字段在顶层，旧导出文件与新文件都能被 Importer 原样读回。
   */
  exportJSON(): string {
    return this.encodeBackup(this.data, this.chatMessages)
  }

  private encodeBackup(data: AppData, chat: ChatMessage[]): string {
    const obj = JSON.parse(
      encodeJSON({ ...data, schemaVersion: CURRENT_SCHEMA_VERSION }),
    ) as Record<string, unknown>
    if (chat.length > 0) obj.chat = JSON.parse(encodeJSON(chat))
    return encodeJSON(obj)
  }

  /** 上一次完整恢复开始前保存的完整快照，可直接下载或重新导入。 */
  getRestoreBackupJSON(): string | null {
    return read(BACKUP_KEY)
  }

  /**
   * 完整恢复事务：先落恢复前快照，再写 data/chat；所有持久化成功后才更新内存。
   * localStorage 没有多键事务，因此第二键失败时尽最大可能还原两个旧值。
   */
  applyRestore(plan: RestorePlan): RestoreStats {
    const snapshot = this.encodeBackup(this.data, this.chatMessages)
    const nextData = encodeJSON({ ...plan.data, schemaVersion: CURRENT_SCHEMA_VERSION })
    const nextChat = encodeJSON(plan.chat)
    const oldData = read(DATA_KEY)
    const oldChat = read(CHAT_KEY)

    if (!write(BACKUP_KEY, snapshot)) throw new Error('无法保存恢复前快照，恢复已取消')
    if (!write(DATA_KEY, nextData)) throw new Error('无法持久化恢复数据，恢复已取消')
    if (!write(CHAT_KEY, nextChat)) {
      const dataRolledBack = oldData == null ? remove(DATA_KEY) : write(DATA_KEY, oldData)
      const chatRolledBack = oldChat == null ? remove(CHAT_KEY) : write(CHAT_KEY, oldChat)
      if (!dataRolledBack || !chatRolledBack) {
        throw new Error('聊天数据持久化失败，且本地存储回滚不完整；内存数据未改变')
      }
      throw new Error('聊天数据持久化失败，已回滚本地存储；内存数据未改变')
    }

    this.data = { ...plan.data, schemaVersion: CURRENT_SCHEMA_VERSION }
    this.chatMessages = plan.chat
    this.emit()
    return plan.stats
  }

  /** 整体替换数据（历史追加导入用） */
  replaceData(next: AppData): void {
    this.commit(next)
  }

  reload(): void {
    const raw = read(DATA_KEY)
    const parsed = raw == null ? null : safeParse(raw)
    const loaded = parsed == null ? emptyAppData() : normalizeData(parsed)
    if (raw == null) {
      loaded.exercises = SEED_EXERCISES
      loaded.foods = SEED_FOODS
    }
    this.data = loaded
    this.emit()
  }
}

// MARK: - 小工具

/**
 * 解析存下来的 JSON。
 *
 * 必须走 decodeJSON 而不是裸 JSON.parse：后者不会把 `date` 还原成 Date，
 * 读回来的数据里日期是字符串，排序时 `.date.getTime()` 直接抛错（刷新页面必崩）。
 */
function safeParse(text: string): unknown {
  try {
    return decodeJSON(text)
  } catch {
    return null
  }
}

function isObject(v: unknown): v is Record<string, any> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

// MARK: - 今日计划变更（AI 聊天用，Mac 版没有对应实现）

/**
 * 落地 AI 的今日计划变更，返回变更摘要与新的 plannedWorkouts（没改到东西时为 null）。
 *
 * 只动「今天的、状态仍为 planned」的计划：已完成的计划改了也不会同步回训练历史，容易误导。
 * patch.splitName 命中今天的某条计划名时改那条（用来在一天多条计划时点名），
 * 没命中就是改名，落到今天的第一条计划上。
 */
function applyPlanPatch(
  patch: PlanPatch,
  data: AppData,
  now: Date,
): { changes: string[]; workouts: PlannedWorkout[] | null } {
  const todays = data.plannedWorkouts.filter(
    (w) => w.status === 'planned' && sameDay(w.date, now),
  )
  const named =
    patch.splitName == null
      ? undefined
      : todays.find((w) => w.splitName === patch.splitName!.trim())
  const target = named ?? todays[0]
  if (target == null) return { changes: [], workouts: null }

  const changes: string[] = []
  let splitName = target.splitName
  if (patch.splitName != null) {
    const v = patch.splitName.trim().slice(0, 30)
    if (v !== '' && v !== splitName) {
      changes.push(`计划名称：${splitName} → ${v}`)
      splitName = v
    }
  }

  let exercises = target.exercises
  if (patch.exercises != null && patch.exercises.length > 0) {
    const next = planExercises(patch.exercises, target.exercises, data)
    if (next.length > 0) {
      changes.push(...planDiff(target.exercises, next))
      exercises = next
    }
  }

  if (changes.length === 0) return { changes: [], workouts: null }
  return {
    changes,
    workouts: data.plannedWorkouts.map((w) =>
      w.id === target.id ? { ...w, splitName, exercises } : w,
    ),
  }
}

/** 把 AI 给的动作列表补成可落地的 PlannedExercise：缺的组次/重量按旧值或配重链兜底 */
function planExercises(
  incoming: PlannedExercisePatch[],
  previous: PlannedExercise[],
  data: AppData,
): PlannedExercise[] {
  const sorted = [...data.bodyMetrics].sort((a, b) => a.date.getTime() - b.date.getTime())
  const bodyWeight = sorted[sorted.length - 1]?.weightKG ?? data.goal.targetWeightKG
  const prevByName = new Map(previous.map((e) => [e.name, e]))

  const out: PlannedExercise[] = []
  for (const raw of incoming) {
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (name === '') continue
    const prev = prevByName.get(name)
    const targetSets = clamp(Math.round(raw.targetSets ?? prev?.targetSets ?? 3), 1, 10)
    const targetReps = clamp(Math.round(raw.targetReps ?? prev?.targetReps ?? 10), 1, 30)
    let targetWeightKG: number
    if (isBodyweight(name)) {
      targetWeightKG = 0
    } else if (raw.targetWeightKG == null || raw.targetWeightKG <= 0) {
      // 模型漏填重量：同名动作沿用原配重，新动作走配重优先级链
      targetWeightKG =
        prev != null && prev.targetWeightKG > 0
          ? prev.targetWeightKG
          : StrengthModel.prescribedWeight(name, targetReps, data, bodyWeight)
    } else {
      targetWeightKG = StrengthModel.roundToPlate(clamp(raw.targetWeightKG, 0, 400))
    }
    out.push({
      id: prev?.id ?? newID(),
      name,
      targetSets,
      targetReps,
      targetWeightKG: Math.max(0, targetWeightKG),
    })
  }
  return out
}

/** 新旧动作列表的差异摘要：新增 / 移除 / 组次重量的变化 */
function planDiff(previous: PlannedExercise[], next: PlannedExercise[]): string[] {
  const diff: string[] = []
  const prevByName = new Map(previous.map((e) => [e.name, e]))
  const nextNames = new Set(next.map((e) => e.name))
  for (const e of next) {
    const prev = prevByName.get(e.name)
    if (prev == null) diff.push(`新增动作：${planLine(e)}`)
    else if (planTarget(prev) !== planTarget(e)) {
      diff.push(`${e.name}：${planTarget(prev)} → ${planTarget(e)}`)
    }
  }
  for (const e of previous) {
    if (!nextNames.has(e.name)) diff.push(`移除动作：${e.name}`)
  }
  return diff
}

function planLine(e: PlannedExercise): string {
  return `${e.name} ${planTarget(e)}`
}

/** 「4×8 60kg」/「4×8 自重」 */
function planTarget(e: PlannedExercise): string {
  return `${e.targetSets}×${e.targetReps} ${weightText(e.name, e.targetWeightKG)}`
}

function normalizeSex(raw: string): string | null {
  const s = raw.toLowerCase().trim()
  if (s.startsWith('m') || s.startsWith('男')) return 'male'
  if (s.startsWith('f') || s.startsWith('女')) return 'female'
  return null
}

function sexLabel(s: string): string {
  return s.toLowerCase().startsWith('f') ? '女' : '男'
}

function normalizeGoalType(raw: string): GoalType | null {
  const s = raw.toLowerCase().trim()
  if (s.includes('bulk') || s.includes('增肌')) return 'bulk'
  if (s.includes('cut') || s.includes('减脂') || s.includes('减重')) return 'cut'
  if (s.includes('maintain') || s.includes('维持') || s.includes('保持')) return 'maintain'
  return null
}

/** 活动系数吸附到设置页提供的档位 */
function snapActivityLevel(raw: number): number | null {
  const levels = [1.2, 1.375, 1.55, 1.725, 1.9]
  let best: number | null = null
  for (const l of levels) {
    // 严格小于：与 Swift 的 min(by:) 一样取第一个最近档位
    if (best == null || Math.abs(l - raw) < Math.abs(best - raw)) best = l
  }
  return best
}

export const store = new AppStore()
export { AppStore, MAX_CHAT, newID }
