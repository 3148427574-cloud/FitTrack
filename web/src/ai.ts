// 对应 Mac 版 Sources/FitTrack/AIService.swift。
//
// 浏览器直连 DeepSeek：没有后端，Key 存在 localStorage（Mac 版是 Keychain）。
// 已实测 DeepSeek 的 CORS 预检会回显 Origin，所以浏览器直接 POST 可用。
//
// 与 Mac 版的差异：
// - Key 的来源改成 store.apiKey。
// - 日期文本用 toLocaleDateString('zh-CN') 代替 Swift 的 `.formatted(date: .numeric)`；
//   只影响喂给模型的上下文文本，不参与任何计算。

import {
  BIG_THREE_LABELS,
  BIG_THREE_LIFTS,
  StrengthModel,
  TrainingPlanner,
  bigThreeValue,
  fmt0,
  fmt1,
  fmt2,
  isBodyweight,
  weightText,
} from './engine'
import {
  GOAL_LABELS,
  newID,
  payloadHasAnyChange,
  type AIUpdatePayload,
  type AppData,
  type PlannedExercise,
  type PlannedWorkout,
  type UserProfile,
} from './models'
import { store } from './store'

// MARK: - 错误

/** 文案与 Swift 的 AIServiceError.errorDescription 一致 */
export class AIError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AIError'
  }
}

// MARK: - 请求

const ENDPOINT = 'https://api.deepseek.com/chat/completions'
const MODEL = 'deepseek-chat'

interface Message {
  role: string
  content: string
}

/** Swift 的 `\(Double)` 会写成 "175.0"（整数也带一位小数） */
function swiftDouble(v: number): string {
  return Number.isInteger(v) ? `${v}.0` : String(v)
}

/** Swift 的 `.formatted(date: .numeric, time: .omitted)` */
function numericDate(d: Date): string {
  return d.toLocaleDateString('zh-CN')
}

function hasKey(): boolean {
  return store.apiKey.trim() !== ''
}

async function send(
  messages: Message[],
  system: string,
  maxTokens = 4000,
  temperature?: number,
): Promise<string> {
  const key = store.apiKey
  if (key.trim() === '') throw new AIError('未设置 API Key')

  const body: Record<string, unknown> = {
    model: MODEL,
    messages: system === '' ? messages : [{ role: 'system', content: system }, ...messages],
    max_tokens: maxTokens,
    stream: false,
  }
  if (temperature != null) body.temperature = temperature

  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw new AIError(`请求失败：${e instanceof Error ? e.message : String(e)}`)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new AIError(`请求失败：HTTP ${res.status}：${text || `HTTP ${res.status}`}`)
  }

  let data: unknown
  try {
    data = await res.json()
  } catch (e) {
    throw new AIError(`解析失败：${e instanceof Error ? e.message : String(e)}`)
  }
  const choices = (data as { choices?: { message?: { content?: string } }[] }).choices
  const text = choices?.[0]?.message?.content
  if (typeof text !== 'string' || text === '') throw new AIError('解析失败：模型返回为空')
  return text
}

// MARK: - 上下文构建

function profileSex(p: UserProfile): string {
  return p.sex.toLowerCase().startsWith('f') ? '女' : '男'
}

function sortedMetrics(data: AppData) {
  return [...data.bodyMetrics].sort((a, b) => a.date.getTime() - b.date.getTime())
}

function latestWeightKG(data: AppData): number {
  const sorted = sortedMetrics(data)
  return sorted.length > 0 ? sorted[sorted.length - 1].weightKG : data.goal.targetWeightKG
}

function latestWeightString(data: AppData): string {
  return `${fmt1(latestWeightKG(data))}kg`
}

/** 生效的三大项极限（手填优先，缺项用历史估算补齐） */
function bigThreeSummary(data: AppData): string {
  const a = StrengthModel.anchors(data)
  const parts = BIG_THREE_LIFTS.flatMap((lift) => {
    const v = bigThreeValue(a, lift)
    if (v == null || v <= 0) return []
    return [`${BIG_THREE_LABELS[lift]} ${fmt0(v)}kg`]
  })
  return parts.length === 0 ? '未录入（辅项按体重比例保守估算）' : parts.join('，')
}

function exerciseLibrary(data: AppData): string {
  return data.exercises.map((e) => `${e.name}(${e.muscleGroup})`).join('、')
}

function bodySummary(data: AppData): string {
  const metrics = sortedMetrics(data)
  if (metrics.length === 0) return '无身体数据'
  const first = metrics[0]
  const last = metrics[metrics.length - 1]
  const days = Math.round(
    (startOfDay(last.date).getTime() - startOfDay(first.date).getTime()) / 86400000,
  )
  const delta = last.weightKG - first.weightKG
  const parts = [
    `共 ${metrics.length} 条，最近 ${fmt1(last.weightKG)}kg（${numericDate(last.date)}）`,
  ]
  if (days > 0) {
    const sign = delta >= 0 ? '+' : ''
    parts.push(`较 ${days} 天前首条 ${fmt1(first.weightKG)}kg 变化 ${sign}${fmt1(delta)}kg`)
  }
  if (last.bodyFatPct != null) parts.push(`体脂 ${fmt1(last.bodyFatPct)}%`)
  return parts.join('，')
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function workoutSummary(data: AppData): string {
  const recent = [...data.workouts]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 20)
  if (recent.length === 0) return '无训练历史'
  return recent
    .map((w) => {
      const exs = w.exercises
        .map((ex) => {
          const best = ex.sets.map((s) => `${s.weightKG}kg×${s.reps}`).join(',')
          return `${ex.name}(${best})`
        })
        .join('；')
      return `${numericDate(w.date)} [${w.splitName}] ${exs}`
    })
    .join('\n')
}

/**
 * 今日待完成计划。聊天上下文靠它让模型知道「今天的计划长什么样」，
 * 也是模型提议 plan 变更（换动作/调组次重量）的唯一依据。
 */
function todayPlanSummary(data: AppData, now: Date = new Date()): string {
  const todays = data.plannedWorkouts.filter(
    (w) => w.status === 'planned' && startOfDay(w.date).getTime() === startOfDay(now).getTime(),
  )
  if (todays.length === 0) return '今日暂无待完成计划'
  return todays
    .map(
      (w) =>
        `[${w.splitName}]\n` +
        w.exercises
          .map(
            (e) =>
              `- ${e.name} ${e.targetSets}×${e.targetReps} ${weightText(e.name, e.targetWeightKG)}`,
          )
          .join('\n'),
    )
    .join('\n')
}

function contextString(data: AppData): string {
  const p = data.profile
  const lines: string[] = []
  lines.push(
    `性别 ${profileSex(p)}，年龄 ${p.age}，身高 ${swiftDouble(p.heightCM)}cm，当前体重 ${latestWeightString(data)}`,
  )
  lines.push(
    `目标 ${GOAL_LABELS[data.goal.type]}（目标体重 ${fmt1(data.goal.targetWeightKG)}kg，每周增减 ${fmt2(data.goal.weeklyTargetDeltaKG)}kg），每周训练 ${p.trainingDaysPerWeek} 天`,
  )
  lines.push(`三大项极限：${bigThreeSummary(data)}`)
  const notes = (data.coachNotes ?? []).filter((n) => n.trim() !== '')
  if (notes.length > 0) {
    lines.push(
      '训练偏好与约束（用户长期设定，必须遵守）：\n' + notes.map((n) => `- ${n}`).join('\n'),
    )
  }
  lines.push(`动作库：${exerciseLibrary(data)}`)
  lines.push(`身体数据趋势：${bodySummary(data)}`)
  lines.push(`今日训练计划（待完成）：\n${todayPlanSummary(data)}`)
  lines.push(`最近训练记录：\n${workoutSummary(data)}`)
  return lines.join('\n')
}

// MARK: - 训练计划生成

interface AIExercise {
  name: string
  targetSets: number
  targetReps: number
  targetWeightKG: number
}

const WEEKDAY_NAMES = ['', '周日', '周一', '周二', '周三', '周四', '周五', '周六']

/**
 * 按用户指定的训练主题生成计划。
 * focus 由「生成今日计划」的选择器给出：胸 / 背 / 腿，或自定义名称（如「肩+三头」）。
 */
async function generatePlan(data: AppData, date: Date, focus: string): Promise<PlannedWorkout> {
  const weekdayName = WEEKDAY_NAMES[date.getDay() + 1] // JS 0=周日，Swift component(.weekday) 1=周日
  const topic = focus.trim()

  const system = `你是一名专业的增肌健身教练。根据用户的训练历史与身体数据变化，为「今天（${weekdayName}）」生成一份训练计划。
用户今天指定练：${topic}。splitName 必须原样填「${topic}」，动作围绕这个主题从动作库中挑选（4-6 个，含必要的辅项）。
要求：
1. 目标重量 = 该动作 1RM × 目标次数对应强度（约 6 次 83%、8 次 79%、10 次 75%、12 次 71%、15 次 67%），四舍五入到 2.5kg 的整数倍。
1RM 优先取该动作自己的历史记录；该动作没有历史数据时，用用户数据里的「三大项极限」按发力模式换算（推类看卧推、蹲类看深蹲、髋铰链看硬拉），再乘以次数强度。
自重动作（如引体向上）targetWeightKG 填 0；无论有无历史数据都不要填 0 或留空。
2. 用户数据里的「训练偏好与约束」是用户的长期设定，必须遵守。
3. 大肌群 48h 恢复：参考最近训练记录，避开近两天已充分刺激的部位。
4. 结合身体趋势与目标（增肌/减脂/维持）微调容量与强度。
5. 动作名称必须从用户动作库中选取，允许用同肌群的库内动作替换。
6. 只输出一个 JSON 对象，不要输出任何其他文字、解释或 markdown 代码块标记，严格遵循此格式：
{"splitName":"胸","reason":"一句话说明安排依据","exercises":[{"name":"杠铃卧推","targetSets":4,"targetReps":8,"targetWeightKG":62.5}]}`

  const text = await send([{ role: 'user', content: contextString(data) }], system, 4000, 0.3)
  const plan = parsePlan(text, date, data, topic)
  if (plan == null) throw new AIError('解析失败：无法解析计划 JSON')
  return plan
}

/**
 * AI 生成失败或未配置 Key 时回退到固定模板。
 * 返回值里带 usedAI：调用方要靠它告诉用户这份计划是 AI 出的还是模板兜的。
 */
async function generatePlanWithFallback(
  data: AppData,
  date: Date,
  focus: string,
): Promise<{ plan: PlannedWorkout; usedAI: boolean }> {
  if (hasKey()) {
    try {
      return { plan: await generatePlan(data, date, focus), usedAI: true }
    } catch {
      // 落到模板
    }
  }
  return { plan: TrainingPlanner.generatePlan(date, data, newID, focus), usedAI: false }
}

/** Swift 侧 AIWorkoutPlan 的字段全是非 optional，缺字段即整包解不出 */
function parsePlan(text: string, date: Date, data: AppData, focus: string): PlannedWorkout | null {
  let s = text.trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start >= 0 && end >= start) s = s.slice(start, end + 1)

  let ai: { splitName: string; reason: string; exercises: AIExercise[] }
  try {
    const raw = JSON.parse(s) as Record<string, unknown>
    if (typeof raw.splitName !== 'string' || typeof raw.reason !== 'string') return null
    if (!Array.isArray(raw.exercises)) return null
    for (const e of raw.exercises as Record<string, unknown>[]) {
      if (
        typeof e.name !== 'string' ||
        typeof e.targetSets !== 'number' ||
        typeof e.targetReps !== 'number' ||
        typeof e.targetWeightKG !== 'number'
      ) {
        return null
      }
    }
    ai = raw as unknown as { splitName: string; reason: string; exercises: AIExercise[] }
  } catch {
    return null
  }

  const bodyWeight = latestWeightKG(data)
  const exercises: PlannedExercise[] = ai.exercises.map((ex) => {
    let weight = ex.targetWeightKG
    // 模型漏填重量时，本地按同一套优先级链补一个
    if (weight <= 0 && !isBodyweight(ex.name)) {
      weight = StrengthModel.prescribedWeight(ex.name, ex.targetReps, data, bodyWeight)
    }
    return {
      id: newID(),
      name: ex.name,
      targetSets: ex.targetSets,
      targetReps: ex.targetReps,
      targetWeightKG: weight,
    }
  })
  return {
    id: newID(),
    date,
    // 名称以用户选的为准：同一天重复生成同一个部位要能被判重
    splitName: focus.trim() === '' ? ai.splitName : focus.trim(),
    exercises,
    status: 'planned',
    note: ai.reason,
  }
}

// MARK: - 聊天

/** 资料变更提议的哨兵标记 */
export const UPDATE_OPEN = '<<<UPDATES>>>'
export const UPDATE_CLOSE = '<<<END>>>'

export interface ChatReply {
  text: string
  /** 待用户确认的资料变更（原始 JSON），null 表示这条回复没有提议 */
  proposalJSON: string | null
}

/** 让模型用哨兵块提出资料/计划变更；App 收到后渲染成待确认卡片，用户点「应用」才写入 */
const UPDATE_PROTOCOL = `你可以在用户表达了长期的目标、身体数据或训练条件变化，或想调整今日训练计划时，提出更新建议。
只在下列情况提议，其余情况一律只回答、不提议：
- 用户明确了训练目标（增肌/减脂/维持）、目标体重或每周增减速度
- 用户说明了自己的长期约束或偏好（例如每周只能练几天、某个动作做不了、偏好低次数力量训练）
- 用户提供了新的身高/年龄/性别/活动量/三大项极限重量
- 用户想调整今日训练计划（换动作、加减动作、改组数/次数/重量、改计划名称），且上下文里能看到今日计划

提议写法：在回复正文之后另起一行，输出下面这一整块。尖括号原样保留，不要用代码块包裹，这一块之后不要再写任何内容：
${UPDATE_OPEN}{"profile":{"age":30,"heightCM":180,"trainingDaysPerWeek":5,"sex":"male","activityLevel":1.55},"goal":{"type":"bulk","targetWeightKG":78,"targetBodyFatPct":15,"weeklyTargetDeltaKG":0.3},"bigThree":{"benchKG":80,"squatKG":110,"deadliftKG":140},"plan":{"splitName":"胸","exercises":[{"name":"上斜哑铃卧推","targetSets":4,"targetReps":10,"targetWeightKG":30},{"name":"绳索下压","targetSets":3,"targetReps":12,"targetWeightKG":25}]},"notes":["偏好低次数力量训练，主项做 5x5"],"reason":"一句话说明建议这样改的理由"}${UPDATE_CLOSE}

字段说明：
- 只写需要改的字段，其余省略；上面所有字段都可以省略。
- profile / goal / bigThree / notes 是长期个人资料；plan 只针对今日计划。
- goal.type 只能取 bulk / cut / maintain；sex 只能取 male / female。
- notes 会长期注入你的上下文，写用户的长期偏好或约束，每条一句话；已有的偏好不要重复提出。
- plan.exercises 必须是调整后今日计划的「完整动作列表」：没改动的动作也要原样带上（组数/次数/重量照抄上下文里的今日计划），按训练顺序排列；动作名称必须来自动作库；自重动作 targetWeightKG 填 0，其余四舍五入到 2.5kg 的整数倍。
- 上下文里没有今日计划（显示「今日暂无待完成计划」）时，不要提议 plan 变更，可以提示用户先生成今日计划。
- 不需要改任何资料时，完全不输出这一块。`

async function chat(history: Message[], context: string): Promise<ChatReply> {
  const system = `你是一名专业的健身与营养教练，帮助用户进行增肌/减脂训练。你可以解答动作替换、动作规范、训练计划调整、饮食营养等问题。
用户也可以直接让你调整「今日训练计划」（换动作、加减动作、改组数/次数/重量），这类改动会以待确认卡片的形式给出，用户点「应用」后才写入。
请结合下方用户真实数据给出个性化、简洁实用的建议，用简体中文回答。

当前用户数据：
${context}

${UPDATE_PROTOCOL}`
  return splitProposal(await send(history, system, 8000))
}

/** 剥掉正文末尾残留的 ``` 围栏行 */
function stripTrailingFences(s: string): string {
  const lines = s.split('\n')
  while (lines.length > 0) {
    const t = lines[lines.length - 1].trim().toLowerCase()
    if (t === '' || t === '```' || t === '```json') lines.pop()
    else break
  }
  return lines.join('\n').trim()
}

/**
 * 只挑出类型正确的字段，供 payloadHasAnyChange 判断用。
 * Swift 那边是整包 decode，一个字段类型不对就全丢；这里至少不能因为
 * `notes` 是字符串而把运行时打崩，所以先做一层收敛。
 */
function sanitizePayload(raw: Record<string, unknown>): AIUpdatePayload {
  const obj = (v: unknown): Record<string, unknown> | null =>
    v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null)
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

  const out: AIUpdatePayload = {}
  const p = obj(raw.profile)
  if (p != null) {
    out.profile = {
      sex: str(p.sex),
      age: num(p.age),
      heightCM: num(p.heightCM),
      activityLevel: num(p.activityLevel),
      trainingDaysPerWeek: num(p.trainingDaysPerWeek),
    }
  }
  const g = obj(raw.goal)
  if (g != null) {
    out.goal = {
      type: str(g.type),
      targetWeightKG: num(g.targetWeightKG),
      targetBodyFatPct: num(g.targetBodyFatPct),
      weeklyTargetDeltaKG: num(g.weeklyTargetDeltaKG),
    }
  }
  const b = obj(raw.bigThree)
  if (b != null) {
    out.bigThree = {
      benchKG: num(b.benchKG),
      squatKG: num(b.squatKG),
      deadliftKG: num(b.deadliftKG),
    }
  }
  if (Array.isArray(raw.notes)) {
    out.notes = raw.notes.filter((n): n is string => typeof n === 'string')
  }
  out.reason = str(raw.reason)
  return out
}

/** 拆出正文与资料变更提案；提案解不出或没有任何实际改动时丢弃，不让坏卡片污染聊天 */
function splitProposal(raw: string): ChatReply {
  const openIdx = raw.indexOf(UPDATE_OPEN)
  const closeIdx = openIdx >= 0 ? raw.indexOf(UPDATE_CLOSE, openIdx + UPDATE_OPEN.length) : -1
  if (openIdx < 0 || closeIdx < 0) {
    return { text: raw.trim(), proposalJSON: null }
  }
  const json = raw.slice(openIdx + UPDATE_OPEN.length, closeIdx).trim()
  const text = stripTrailingFences(raw.slice(0, openIdx) + raw.slice(closeIdx + UPDATE_CLOSE.length))

  let payload: AIUpdatePayload | null = null
  try {
    const parsed = JSON.parse(json) as unknown
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = sanitizePayload(parsed as Record<string, unknown>)
    }
  } catch {
    payload = null
  }
  if (payload == null || !payloadHasAnyChange(payload)) {
    return { text, proposalJSON: null }
  }
  return { text, proposalJSON: json }
}

export const AIService = {
  ENDPOINT,
  MODEL,
  hasKey,
  send,
  contextString,
  bigThreeSummary,
  generatePlan,
  generatePlanWithFallback,
  chat,
  splitProposal,
}

export { contextString, hasKey }
export type { Message as AIMessage }