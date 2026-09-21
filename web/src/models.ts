// 对应 Mac 版 Sources/FitTrack/Models.swift。
// 字段名与 JSON 结构必须和 Swift 版逐字一致：两边的导出文件要能互相导入。
// 唯一的表示差异是日期 —— Swift 用 Date，这里用 JS Date，序列化时统一成秒精度 ISO8601。

// MARK: - 枚举

export type GoalType = 'bulk' | 'cut' | 'maintain'

export const GOAL_TYPES: GoalType[] = ['bulk', 'cut', 'maintain']

export const GOAL_LABELS: Record<GoalType, string> = {
  bulk: '增肌',
  cut: '减脂',
  maintain: '维持',
}

export type WorkoutStatus = 'planned' | 'completed' | 'skipped'

export const WORKOUT_STATUS_LABELS: Record<WorkoutStatus, string> = {
  planned: '待完成',
  completed: '已完成',
  skipped: '已跳过',
}

// MARK: - 训练相关

export interface SetEntry {
  reps: number
  weightKG: number
}

export interface ExerciseEntry {
  id: string
  name: string
  sets: SetEntry[]
  rpe?: number | null
}

export interface WorkoutSession {
  id: string
  date: Date
  splitName: string
  exercises: ExerciseEntry[]
  durationMin: number
  notes: string
}

export interface PlannedExercise {
  id: string
  name: string
  targetSets: number
  targetReps: number
  targetWeightKG: number
}

export interface PlannedWorkout {
  id: string
  date: Date
  splitName: string
  exercises: PlannedExercise[]
  status: WorkoutStatus
  note?: string | null
  /** Mac 版用来关联 EKReminder；网页版保留字段以便原样读写 Mac 导出的数据 */
  reminderID?: string | null
}

// MARK: - 身体数据

export interface BodyMetric {
  id: string
  date: Date
  weightKG: number
  bodyFatPct?: number | null
  muscleMassKG?: number | null
  waistCM?: number | null
  chestCM?: number | null
  armCM?: number | null
  thighCM?: number | null
}

export interface Goal {
  type: GoalType
  targetWeightKG: number
  targetBodyFatPct?: number | null
  weeklyTargetDeltaKG: number
}

export interface UserProfile {
  sex: string
  age: number
  heightCM: number
  activityLevel: number
  trainingDaysPerWeek: number
}

/** 三大项极限重量（1RM，kg）。手填优先，未填时回退到历史训练估算。 */
export interface BigThreeMax {
  benchKG?: number | null
  squatKG?: number | null
  deadliftKG?: number | null
}

export function bigThreeIsEmpty(m: BigThreeMax): boolean {
  return m.benchKG == null && m.squatKG == null && m.deadliftKG == null
}

// MARK: - 动作库 / 食物库 / 饮食记录

export interface ExerciseDef {
  id: string
  name: string
  muscleGroup: string
  equipment: string
  isBodyweight: boolean
}

export interface Food {
  id: string
  name: string
  kcalPer100g: number
  proteinPer100g: number
  carbPer100g: number
  fatPer100g: number
}

export interface DietLog {
  id: string
  date: Date
  foodName: string
  amountG: number
}

// MARK: - AI 聊天

export interface ChatMessage {
  id: string
  role: string // "user" / "assistant"
  content: string
  /** AI 提议的资料变更（原始 JSON），非空时聊天里渲染确认卡片 */
  proposal?: string | null
  /** null = 待处理，"applied" / "dismissed" = 已终结 */
  proposalStatus?: string | null
  /** 应用后的变更摘要，用于在聊天里回显实际改了什么 */
  proposalResult?: string[] | null
}

export function isProposalPending(m: ChatMessage): boolean {
  return m.proposal != null && (m.proposalStatus ?? '') === ''
}

// MARK: - AI 资料变更载荷

export interface ProfilePatch {
  sex?: string | null
  age?: number | null
  heightCM?: number | null
  activityLevel?: number | null
  trainingDaysPerWeek?: number | null
}

export interface GoalPatch {
  type?: string | null
  targetWeightKG?: number | null
  targetBodyFatPct?: number | null
  weeklyTargetDeltaKG?: number | null
}

export interface BigThreePatch {
  benchKG?: number | null
  squatKG?: number | null
  deadliftKG?: number | null
}

export interface PlannedExercisePatch {
  name: string
  targetSets?: number | null
  targetReps?: number | null
  targetWeightKG?: number | null
}

/**
 * AI 对今日训练计划的修改。
 * exercises 是调整后的「完整动作列表」——未改动的动作也要原样带上，
 * 落地时整体替换，这样预览卡片展示的就是最终结果，不用猜增量语义。
 */
export interface PlanPatch {
  /** 新的计划名称（如「胸」「肩+三头」）；缺省表示不改名 */
  splitName?: string | null
  /** 调整后的完整动作列表；缺省或空数组表示不改动作 */
  exercises?: PlannedExercisePatch[] | null
}

/** AI 可以提议修改的个人资料字段（白名单）。单个字段缺失即不改。 */
export interface AIUpdatePayload {
  profile?: ProfilePatch | null
  goal?: GoalPatch | null
  bigThree?: BigThreePatch | null
  /** 今日训练计划的调整（网页版新增，Mac 版没有） */
  plan?: PlanPatch | null
  /** 追加到 AppData.coachNotes 的长期偏好/约束 */
  notes?: string[] | null
  /** 一句话说明改动理由，显示在确认卡片上 */
  reason?: string | null
}

/** 计划变更里「有名字」的动作条数：无名条目会被落地逻辑丢弃，不算一次改动 */
export function planExerciseCount(p: PlanPatch): number {
  return (p.exercises ?? []).filter((e) => typeof e.name === 'string' && e.name.trim() !== '')
    .length
}

export function payloadHasAnyChange(p: AIUpdatePayload): boolean {
  const has = <T>(v: T | null | undefined, f: (x: T) => boolean): boolean =>
    v == null ? false : f(v)
  return (
    has(p.profile, (x) =>
      x.sex != null ||
      x.age != null ||
      x.heightCM != null ||
      x.activityLevel != null ||
      x.trainingDaysPerWeek != null,
    ) ||
    has(p.goal, (x) =>
      x.type != null ||
      x.targetWeightKG != null ||
      x.targetBodyFatPct != null ||
      x.weeklyTargetDeltaKG != null,
    ) ||
    has(p.bigThree, (x) => x.benchKG != null || x.squatKG != null || x.deadliftKG != null) ||
    has(p.plan, (x) => x.splitName != null || planExerciseCount(x) > 0) ||
    (p.notes ?? []).filter((n) => n.trim() !== '').length > 0
  )
}

// MARK: - 根数据

export interface AppData {
  profile: UserProfile
  goal: Goal
  workouts: WorkoutSession[]
  plannedWorkouts: PlannedWorkout[]
  bodyMetrics: BodyMetric[]
  foods: Food[]
  exercises: ExerciseDef[]
  dietLogs: DietLog[]
  /** 三大项极限重量（手填优先） */
  bigThree?: BigThreeMax | null
  /** 用户在对话中表达的长期偏好与约束，会注入 AI 上下文 */
  coachNotes?: string[] | null
}

export function emptyAppData(): AppData {
  return {
    profile: { sex: 'male', age: 25, heightCM: 175, activityLevel: 1.55, trainingDaysPerWeek: 4 },
    goal: { type: 'bulk', targetWeightKG: 75, targetBodyFatPct: null, weeklyTargetDeltaKG: 0.25 },
    workouts: [],
    plannedWorkouts: [],
    bodyMetrics: [],
    foods: [],
    exercises: [],
    dietLogs: [],
    bigThree: null,
    coachNotes: null,
  }
}

// MARK: - 序列化
//
// Swift 版用 JSONEncoder + dateEncodingStrategy = .iso8601，写出的是秒精度 ISO8601
// （形如 2026-09-20T07:37:07Z，不带毫秒）。JS 的 Date.toJSON() 会带上 ".123Z"，
// 所以这里显式裁掉毫秒，保证两边导出的文件逐字节一致。

export function toISO(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** 唯一的日期字段名就是 `date`，据此还原，避免误伤内容里像日期的字符串 */
function reviveDates(_key: string, value: unknown): unknown {
  if (_key === 'date' && typeof value === 'string') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? value : d
  }
  return value
}

/**
 * 与 Swift 的 `.prettyPrinted, .sortedKeys` + iso8601 逐字节对齐。
 *
 * 不能拿 JSON.stringify 交差，实测和 Foundation 差三处（都被「用真实数据文件来回导一遍」
 * 的脚本抓到过）：
 *
 * 1. 键顺序 —— Swift 的 sortedKeys 排过，stringify 按插入序。
 * 2. `"key" : value` —— Foundation 在冒号前留一个空格，JS 不留。
 * 3. `[` 和 `{` 为空时 Foundation 写成 `[\n\n  ]`（中间一空行），JS 写成 `[]`。
 *
 * 外加 Swift 合成 Codable 对 Optional 用 encodeIfPresent：nil 字段整个键都不写，
 * 而 JS 会写成 `null`（真实数据文件里 `coachNotes`/`targetBodyFatPct`/`rpe` 确实缺席）。
 * 这个 schema 里可空字段都是 Swift Optional，所以「值为 null/undefined 就丢掉」正好对。
 * 另外 Foundation 会把 `/` 转义成 `\/`，`0x08`→`\b`、`0x0c`→`\f`、其余控制字符→`\u00xx`。
 */
export function encodeJSON(value: unknown): string {
  return encodeValue(value, 0)
}

const INDENT = '  '

function encodeValue(value: unknown, level: number): string {
  if (value == null) return 'null'
  if (value instanceof Date) return `"${toISO(value)}"`
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return isFinite(value) ? String(value) : 'null'
  if (typeof value === 'string') return encodeString(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return `[\n\n${INDENT.repeat(level)}]`
    const items = value.map((v) => INDENT.repeat(level + 1) + encodeValue(v, level + 1))
    return `[\n${items.join(',\n')}\n${INDENT.repeat(level)}]`
  }
  if (typeof value === 'object') {
    const src = value as Record<string, unknown>
    const keys = Object.keys(src)
      .filter((k) => src[k] != null)
      .sort()
    if (keys.length === 0) return `{\n\n${INDENT.repeat(level)}}`
    const entries = keys.map(
      (k) =>
        `${INDENT.repeat(level + 1)}${encodeString(k)} : ${encodeValue(src[k], level + 1)}`,
    )
    return `{\n${entries.join(',\n')}\n${INDENT.repeat(level)}}`
  }
  return 'null'
}

function encodeString(s: string): string {
  let out = '"'
  for (const ch of s) {
    switch (ch) {
      case '"':
        out += '\\"'
        continue
      case '\\':
        out += '\\\\'
        continue
      case '/':
        out += '\\/'
        continue
      case '\b':
        out += '\\b'
        continue
      case '\f':
        out += '\\f'
        continue
      case '\n':
        out += '\\n'
        continue
      case '\r':
        out += '\\r'
        continue
      case '\t':
        out += '\\t'
        continue
    }
    const code = ch.codePointAt(0)!
    out += code < 0x20 ? `\\u${code.toString(16).padStart(4, '0')}` : ch
  }
  return `${out}"`
}

export function decodeJSON<T>(text: string): T {
  return JSON.parse(text, reviveDates) as T
}

// MARK: - 种子数据

export const SEED_EXERCISES: ExerciseDef[] = [
  ['杠铃卧推', '胸', '杠铃'],
  ['上斜哑铃卧推', '胸', '哑铃'],
  ['站姿推举', '肩', '杠铃'],
  ['哑铃侧平举', '肩', '哑铃'],
  ['杠铃划船', '背', '杠铃'],
  ['坐姿划船', '背', '绳索'],
  ['高位下拉', '背', '绳索'],
  ['引体向上', '背', '自重'],
  ['面拉', '肩', '绳索'],
  ['杠铃深蹲', '腿', '杠铃'],
  ['罗马尼亚硬拉', '腿', '杠铃'],
  ['硬拉', '背', '杠铃'],
  ['腿举', '腿', '器械'],
  ['腿屈伸', '腿', '器械'],
  ['腿弯举', '腿', '器械'],
  ['站姿提踵', '小腿', '器械'],
  ['坐姿提踵', '小腿', '器械'],
  ['保加利亚分腿蹲', '腿', '哑铃'],
  ['臀桥', '臀', '杠铃'],
  ['哑铃弯举', '二头', '哑铃'],
  ['锤式弯举', '二头', '哑铃'],
  ['绳索下压', '三头', '绳索'],
  ['仰卧臂屈伸', '三头', '哑铃'],
].map(([name, muscleGroup, equipment]) => ({
  id: newID(),
  name,
  muscleGroup,
  equipment,
  isBodyweight: name === '引体向上',
}))

export const SEED_FOODS: Food[] = (
  [
    ['鸡胸肉', 165, 31, 0, 3.6],
    ['鸡蛋', 143, 12.6, 0.7, 9.5],
    ['瘦牛肉', 250, 26, 0, 15],
    ['三文鱼', 208, 20, 0, 13],
    ['米饭(熟)', 116, 2.6, 25.9, 0.3],
    ['燕麦', 389, 16.9, 66, 6.9],
    ['全麦面包', 247, 13, 41, 3.4],
    ['红薯', 86, 1.6, 20, 0.1],
    ['香蕉', 89, 1.1, 23, 0.3],
    ['花生酱', 588, 25, 20, 50],
    ['牛奶', 61, 3.2, 4.8, 3.3],
    ['希腊酸奶', 59, 10, 3.6, 0.4],
    ['西兰花', 34, 2.8, 7, 0.4],
    ['橄榄油', 884, 0, 0, 100],
    ['乳清蛋白粉', 400, 80, 10, 5],
    ['杏仁', 579, 21, 22, 50],
  ] as const
).map(([name, kcalPer100g, proteinPer100g, carbPer100g, fatPer100g]) => ({
  id: newID(),
  name,
  kcalPer100g,
  proteinPer100g,
  carbPer100g,
  fatPer100g,
}))

// MARK: - ID

export function newID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
