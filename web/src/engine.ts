// 对应 Mac 版 Sources/FitTrack/Engine.swift。
// 算法口径必须与 Swift 版逐值一致 —— 用 Swift 版当 oracle 的测试在 engine.test.ts。

import type {
  AppData,
  BigThreeMax,
  Food,
  Goal,
  PlannedExercise,
  PlannedWorkout,
  UserProfile,
  WorkoutSession,
} from './models'

// MARK: - 数值格式化（对应 Swift 的 String(format:)）
//
// Swift 的 Double.rounded() 是 toNearestOrAwayFromZero，JS 的 Math.round 对负数
// 是向 +∞ 取整（Math.round(-0.5) === -0）。配重全是非负数，但保持语义一致更稳。

export function swiftRound(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x))
}

/**
 * `String(format: "%.Nf")` 的等价实现。
 *
 * 不能用 toFixed：printf 按 IEEE 默认舍入模式（就近取偶）处理 .5，182.5 格式化成
 * "182"；JS 的 toFixed 是「就近远离零」，会给出 "183"。身高 182.5cm 正好踩在这上面，
 * oracle 测试当场抓到了。这里用 BigInt 取 Double 的精确十进制值，再就近取偶。
 */
function printfFixed(x: number, digits: number): string {
  const neg = x < 0
  const scaled = exactScaledRound(Math.abs(x), digits)
  const a = scaled < 0n ? -scaled : scaled
  let s = a.toString()
  if (digits > 0) {
    s = s.padStart(digits + 1, '0')
    s = `${s.slice(0, s.length - digits)}.${s.slice(s.length - digits)}`
  }
  return (neg ? '-' : '') + s
}

/** round-half-even(|x| × 10^digits)，用 BigInt 精确计算，不引入浮点误差 */
function exactScaledRound(ax: number, digits: number): bigint {
  if (ax === 0) return 0n
  const buf = new DataView(new ArrayBuffer(8))
  buf.setFloat64(0, ax)
  const hi = buf.getUint32(0)
  const lo = buf.getUint32(4)
  const expBits = (hi >>> 20) & 0x7ff
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo)
  let e: number
  if (expBits === 0) {
    e = -1074 // subnormal
  } else {
    mant |= 1n << 52n
    e = expBits - 1075
  }
  // 精确值 = mant × 2^e，目标 = mant × 2^e × 10^digits
  let num = mant * 10n ** BigInt(digits)
  if (e >= 0) {
    num <<= BigInt(e)
    return num
  }
  const denom = 1n << BigInt(-e)
  const quot = num / denom
  const twice = (num % denom) * 2n
  if (twice > denom) return quot + 1n
  if (twice < denom) return quot
  return quot % 2n === 0n ? quot : quot + 1n
}

export function fmt1(x: number): string {
  return printfFixed(x, 1)
}

export function fmt0(x: number): string {
  return printfFixed(x, 0)
}

export function fmt2(x: number): string {
  return printfFixed(x, 2)
}

// MARK: - 能量消耗（TDEE）

export const TDEE = {
  /** Mifflin-St Jeor 基础代谢 */
  bmr(profile: UserProfile, weightKG: number): number {
    const base = 10 * weightKG + 6.25 * profile.heightCM - 5 * profile.age
    return profile.sex.toLowerCase().startsWith('f') ? base - 161 : base + 5
  },

  tdee(profile: UserProfile, weightKG: number): number {
    return TDEE.bmr(profile, weightKG) * profile.activityLevel
  },
}

// MARK: - 饮食计划

export interface Macros {
  kcal: number
  protein: number
  carb: number
  fat: number
}

export const DietPlanner = {
  /** 根据目标计算每日热量与三大营养素（单位：克，热量：千卡） */
  targets(profile: UserProfile, goal: Goal, weightKG: number): Macros {
    const tdee = TDEE.tdee(profile, weightKG)
    let kcal: number
    switch (goal.type) {
      case 'bulk':
        kcal = tdee + 400
        break
      case 'cut':
        kcal = tdee - 400
        break
      default:
        kcal = tdee
    }
    const protein = (goal.type === 'maintain' ? 1.6 : 2.0) * weightKG
    const fat = 0.9 * weightKG
    const carbKcal = Math.max(0, kcal - protein * 4 - fat * 9)
    return { kcal, protein, carb: carbKcal / 4, fat }
  },

  /** 从食物库按目标克数简单搭配餐单（按 4 餐分配） */
  sampleMealPlan(
    profile: UserProfile,
    goal: Goal,
    weightKG: number,
    foods: Food[],
  ): string[] {
    const m = DietPlanner.targets(profile, goal, weightKG)
    const proteinFoods = foods
      .filter((f) => f.proteinPer100g > 15)
      .sort((a, b) => b.proteinPer100g - a.proteinPer100g)
    const carbFoods = foods
      .filter((f) => f.carbPer100g > 15)
      .sort((a, b) => b.carbPer100g - a.carbPer100g)
    const fatFoods = foods
      .filter((f) => f.fatPer100g > 15)
      .sort((a, b) => b.fatPer100g - a.fatPer100g)
    const [p, c, f] = [proteinFoods[0], carbFoods[0], fatFoods[0]]
    if (!p || !c || !f) {
      return ['食物库为空，请先导入或补充食物']
    }
    const pAmount = m.protein / 4 / (p.proteinPer100g / 100)
    const cAmount = m.carb / 4 / (c.carbPer100g / 100)
    const fAmount = m.fat / 4 / (f.fatPer100g / 100)
    const lines: string[] = []
    lines.push(
      `目标：${fmt0(m.kcal)} 千卡 / 蛋白质 ${fmt0(m.protein)}g / 碳水 ${fmt0(m.carb)}g / 脂肪 ${fmt0(m.fat)}g`,
    )
    for (let i = 1; i <= 4; i++) {
      lines.push(
        `第${i}餐：${p.name} ${fmt0(pAmount)}g + ${c.name} ${fmt0(cAmount)}g + ${f.name} ${fmt0(fAmount)}g`,
      )
    }
    return lines
  },
}

// MARK: - 卡路里消耗估算

export const BODYWEIGHT_EXERCISES = new Set(['引体向上'])

export const COMPOUND_EXERCISES = new Set([
  '杠铃卧推', '上斜哑铃卧推', '站姿推举', '杠铃划船', '坐姿划船', '高位下拉',
  '杠铃深蹲', '罗马尼亚硬拉', '硬拉', '腿举', '保加利亚分腿蹲', '臀桥',
])

export function isBodyweight(name: string): boolean {
  return BODYWEIGHT_EXERCISES.has(name)
}

/** 力量训练代谢当量（1 MET = 1 千卡/公斤/小时） */
export function met(name: string): number {
  if (isBodyweight(name)) return 5.0
  if (COMPOUND_EXERCISES.has(name)) return 6.0
  return 4.5
}

/** MET 表按成年人平均身高标定，身高校正以此为原点 */
export const REFERENCE_HEIGHT_CM = 175

/**
 * 行程敏感度：身高每偏离基准 1%，该动作能耗近似同向变化 s%。
 * 深蹲/硬拉位移接近整条腿长，提踵/臂屈伸位移只由小关节决定。
 */
export const ROM_SENSITIVITY: Record<string, number> = {
  杠铃深蹲: 0.8, 硬拉: 0.8, 罗马尼亚硬拉: 0.8, 保加利亚分腿蹲: 0.8, 腿举: 0.7,
  站姿推举: 0.6, 引体向上: 0.6, 高位下拉: 0.6, 杠铃划船: 0.6, 坐姿划船: 0.5,
  杠铃卧推: 0.5, 上斜哑铃卧推: 0.5,
  臀桥: 0.4, 腿屈伸: 0.3, 腿弯举: 0.3,
  哑铃侧平举: 0.3, 面拉: 0.3, 哑铃弯举: 0.3, 锤式弯举: 0.3,
  绳索下压: 0.2, 仰卧臂屈伸: 0.2,
  站姿提踵: 0.15, 坐姿提踵: 0.15,
}

export function romSensitivity(name: string): number {
  return ROM_SENSITIVITY[name] ?? 0.4
}

/**
 * 身高的行程修正系数，夹紧到 ±8%，避免极端身高给出离谱估算。
 * 这是启发式模型：总能耗里随行程变化的只有克服重力做功那一部分，
 * 等长收缩、心肺与恢复成本与肢体长度无关，所以修正量必须温和。
 */
export function heightFactor(name: string, heightCM: number): number {
  if (!(heightCM > 0)) return 1
  const raw = 1 + romSensitivity(name) * (heightCM / REFERENCE_HEIGHT_CM - 1)
  return Math.min(Math.max(raw, 0.92), 1.08)
}

/** 未经身高校正的基础估算：MET × 体重(kg) × 时长(小时)，每组约 1.5 分钟（含组间休息） */
export function baseCalories(ex: PlannedExercise, bodyWeightKG: number): number {
  return (met(ex.name) * bodyWeightKG * ex.targetSets * 1.5) / 60.0
}

/** 单动作估算消耗（千卡）= 基础估算 × 身高的行程修正 */
export function calories(
  ex: PlannedExercise,
  bodyWeightKG: number,
  heightCM: number,
): number {
  return baseCalories(ex, bodyWeightKG) * heightFactor(ex.name, heightCM)
}

export function baseTotal(workout: PlannedWorkout, bodyWeightKG: number): number {
  return workout.exercises.reduce((sum, ex) => sum + baseCalories(ex, bodyWeightKG), 0)
}

export function totalCalories(
  workout: PlannedWorkout,
  bodyWeightKG: number,
  heightCM: number,
): number {
  return workout.exercises.reduce(
    (sum, ex) => sum + calories(ex, bodyWeightKG, heightCM),
    0,
  )
}

/** 无历史 1RM 时的保守起始重量（自重动作返回 0） */
export function defaultWeight(name: string, bodyWeightKG: number): number {
  if (isBodyweight(name)) return 0
  const ratios: Record<string, number> = {
    杠铃深蹲: 0.5, 硬拉: 0.6, 杠铃卧推: 0.4, 站姿推举: 0.25,
    杠铃划船: 0.35, 罗马尼亚硬拉: 0.5, 腿举: 0.6,
    上斜哑铃卧推: 0.15, 坐姿划船: 0.25, 高位下拉: 0.3,
    保加利亚分腿蹲: 0.1, 臀桥: 0.3,
  }
  const w = (ratios[name] ?? 0.2) * bodyWeightKG
  return swiftRound(w / 2.5) * 2.5
}

// MARK: - 力量基准（三大项 + 历史 1RM）

export type BigThreeLift = 'bench' | 'squat' | 'deadlift'

export const BIG_THREE_LIFTS: BigThreeLift[] = ['bench', 'squat', 'deadlift']

export const BIG_THREE_LABELS: Record<BigThreeLift, string> = {
  bench: '卧推',
  squat: '深蹲',
  deadlift: '硬拉',
}

/** 训练记录里对应的主项动作名 */
export const BIG_THREE_EXERCISE_NAMES: Record<BigThreeLift, string[]> = {
  bench: ['杠铃卧推'],
  squat: ['杠铃深蹲'],
  deadlift: ['硬拉'],
}

export function bigThreeValue(m: BigThreeMax, lift: BigThreeLift): number | null {
  const v = lift === 'bench' ? m.benchKG : lift === 'squat' ? m.squatKG : m.deadliftKG
  return v ?? null
}

export function bigThreeSet(m: BigThreeMax, lift: BigThreeLift, v: number | null): void {
  if (lift === 'bench') m.benchKG = v
  else if (lift === 'squat') m.squatKG = v
  else m.deadliftKG = v
}

/** 由训练历史与三大项极限推导训练配重。 */
export const StrengthModel = {
  /** Epley 公式估算 1RM */
  oneRepMax(weight: number, reps: number): number {
    if (!(reps > 0) || !(weight > 0)) return 0
    return weight * (1 + reps / 30.0)
  },

  /** 目标次数的训练强度（%1RM），与 oneRepMax 互为逆运算 */
  intensity(reps: number): number {
    if (!(reps > 0)) return 0.75
    return 1.0 / (1.0 + reps / 30.0)
  },

  roundToPlate(kg: number): number {
    return swiftRound(kg / 2.5) * 2.5
  },

  /** 某动作历史最好 1RM */
  best1RM(exercise: string, workouts: WorkoutSession[]): number {
    let best = 0
    for (const w of workouts) {
      for (const e of w.exercises) {
        if (e.name !== exercise) continue
        for (const s of e.sets) {
          const v = StrengthModel.oneRepMax(s.weightKG, s.reps)
          if (v > best) best = v
        }
      }
    }
    return best
  },

  /**
   * 做渐进超负荷基准的 1RM：优先最近 30 天，没有近期记录再退回历史最好，
   * 避免一年前的 PR 把今天的配重顶得过高。
   */
  prescription1RM(
    exercise: string,
    workouts: WorkoutSession[],
    withinDays = 30,
    now: Date = new Date(),
  ): number {
    const cutoff = new Date(now.getTime() - withinDays * 24 * 60 * 60 * 1000)
    const recent = StrengthModel.best1RM(
      exercise,
      workouts.filter((w) => w.date >= cutoff),
    )
    return recent > 0 ? recent : StrengthModel.best1RM(exercise, workouts)
  },

  /** 从训练历史估算三大项极限 */
  historicalAnchors(workouts: WorkoutSession[]): BigThreeMax {
    const m: BigThreeMax = {}
    for (const lift of BIG_THREE_LIFTS) {
      const names = BIG_THREE_EXERCISE_NAMES[lift]
      const v = Math.max(...names.map((n) => StrengthModel.best1RM(n, workouts)), 0)
      bigThreeSet(m, lift, v > 0 ? StrengthModel.roundToPlate(v) : null)
    }
    return m
  },

  /** 生效锚点：手填优先，缺项用历史补齐 */
  anchors(data: AppData): BigThreeMax {
    const manual = data.bigThree ?? {}
    const hist = StrengthModel.historicalAnchors(data.workouts)
    const m: BigThreeMax = {}
    for (const lift of BIG_THREE_LIFTS) {
      bigThreeSet(m, lift, bigThreeValue(manual, lift) ?? bigThreeValue(hist, lift))
    }
    return m
  },

  /**
   * 辅项 1RM 相对三大项的倍数。器械类个体差异极大（腿举能差 2 倍），取偏保守值。
   * 哑铃类为单只重量。
   */
  anchorRatios: {
    // 三大项本身：手填/历史锚点直接就是它们的 1RM
    杠铃卧推: { lift: 'bench', ratio: 1.0 },
    杠铃深蹲: { lift: 'squat', ratio: 1.0 },
    硬拉: { lift: 'deadlift', ratio: 1.0 },
    站姿推举: { lift: 'bench', ratio: 0.62 },
    上斜哑铃卧推: { lift: 'bench', ratio: 0.35 },
    杠铃划船: { lift: 'bench', ratio: 0.85 },
    坐姿划船: { lift: 'bench', ratio: 0.85 },
    高位下拉: { lift: 'bench', ratio: 0.95 },
    面拉: { lift: 'bench', ratio: 0.4 },
    哑铃侧平举: { lift: 'bench', ratio: 0.12 },
    哑铃弯举: { lift: 'bench', ratio: 0.22 },
    锤式弯举: { lift: 'bench', ratio: 0.24 },
    绳索下压: { lift: 'bench', ratio: 0.45 },
    仰卧臂屈伸: { lift: 'bench', ratio: 0.18 },
    罗马尼亚硬拉: { lift: 'deadlift', ratio: 0.8 },
    腿举: { lift: 'squat', ratio: 2.5 },
    保加利亚分腿蹲: { lift: 'squat', ratio: 0.2 },
    臀桥: { lift: 'squat', ratio: 1.3 },
    腿屈伸: { lift: 'squat', ratio: 0.55 },
    腿弯举: { lift: 'squat', ratio: 0.45 },
    站姿提踵: { lift: 'squat', ratio: 1.4 },
    坐姿提踵: { lift: 'squat', ratio: 1.2 },
  } as Record<string, { lift: BigThreeLift; ratio: number }>,

  /** 由三大项锚点推导某动作的 1RM；没有对应锚点或系数时返回 null */
  anchor1RM(exercise: string, data: AppData): number | null {
    const entry = StrengthModel.anchorRatios[exercise]
    if (!entry) return null
    const base = bigThreeValue(StrengthModel.anchors(data), entry.lift)
    if (base == null || !(base > 0)) return null
    return base * entry.ratio
  },

  /** 配重优先级：本动作近期 1RM → 三大项锚点推导 → 体重比例兜底 */
  prescribedWeight(
    exercise: string,
    reps: number,
    data: AppData,
    bodyWeightKG: number,
  ): number {
    if (isBodyweight(exercise)) return 0
    const intensity = StrengthModel.intensity(reps)
    const direct = StrengthModel.prescription1RM(exercise, data.workouts)
    if (direct > 0) return StrengthModel.roundToPlate(direct * intensity)
    const anchor = StrengthModel.anchor1RM(exercise, data)
    if (anchor != null) return StrengthModel.roundToPlate(anchor * intensity)
    return defaultWeight(exercise, bodyWeightKG)
  },
}

// MARK: - 训练计划生成 + 渐进超负荷

export interface SplitTemplate {
  name: string
  items: { name: string; sets: number; reps: number }[]
}

function tpl(name: string, items: [string, number, number][]): SplitTemplate {
  return { name, items: items.map(([n, s, r]) => ({ name: n, sets: s, reps: r })) }
}

const PUSH = tpl('推', [
  ['杠铃卧推', 4, 8], ['上斜哑铃卧推', 3, 10], ['站姿推举', 3, 8],
  ['哑铃侧平举', 3, 15], ['绳索下压', 3, 12], ['仰卧臂屈伸', 3, 12],
])
const PULL = tpl('拉', [
  ['硬拉', 4, 6], ['引体向上', 3, 8], ['杠铃划船', 3, 10],
  ['面拉', 3, 15], ['哑铃弯举', 3, 12], ['锤式弯举', 3, 12],
])
const LEGS = tpl('腿', [
  ['杠铃深蹲', 4, 8], ['罗马尼亚硬拉', 3, 10], ['腿举', 3, 12],
  ['腿弯举', 3, 12], ['站姿提踵', 4, 15],
])
const UPPER_A = tpl('上肢A', [
  ['杠铃卧推', 4, 8], ['坐姿划船', 4, 10], ['站姿推举', 4, 8],
  ['引体向上', 3, 8], ['哑铃弯举', 3, 12], ['绳索下压', 3, 12],
])
const LOWER_A = tpl('下肢A', [
  ['杠铃深蹲', 4, 8], ['罗马尼亚硬拉', 4, 10], ['腿举', 4, 12],
  ['腿弯举', 3, 12], ['站姿提踵', 4, 15],
])
const UPPER_B = tpl('上肢B', [
  ['上斜哑铃卧推', 4, 10], ['高位下拉', 4, 10], ['杠铃划船', 4, 8],
  ['哑铃侧平举', 3, 15], ['锤式弯举', 3, 12], ['仰卧臂屈伸', 3, 12],
])
const LOWER_B = tpl('下肢B', [
  ['硬拉', 4, 6], ['保加利亚分腿蹲', 3, 10], ['腿屈伸', 3, 12],
  ['臀桥', 3, 12], ['坐姿提踵', 4, 15],
])
const FULL = tpl('全身', [
  ['杠铃深蹲', 3, 8], ['杠铃卧推', 3, 8], ['杠铃划船', 3, 8],
  ['站姿推举', 3, 10], ['哑铃弯举', 2, 12], ['绳索下压', 2, 12],
])

export const TrainingPlanner = {
  /** 根据每周训练天数选择拆分模板 */
  splits(days: number): SplitTemplate[] {
    if (days <= 2) return [FULL]
    if (days === 3) return [PUSH, PULL, LEGS]
    if (days === 4) return [UPPER_A, LOWER_A, UPPER_B, LOWER_B]
    if (days === 5) return [PUSH, PULL, LEGS, UPPER_A, LOWER_A]
    return [PUSH, PULL, LEGS, UPPER_A, LOWER_A, FULL]
  },

  /** 生成某天的训练计划：按目标次数对应的强度自动配重 */
  generatePlan(date: Date, data: AppData, newID: () => string): PlannedWorkout {
    const templates = TrainingPlanner.splits(data.profile.trainingDaysPerWeek)
    const weekday = date.getDay() + 1 // JS 0=周日，Swift component(.weekday) 1=周日
    const split = templates[(weekday - 1) % templates.length]
    const sorted = [...data.bodyMetrics].sort((a, b) => a.date.getTime() - b.date.getTime())
    const bodyWeight = sorted[sorted.length - 1]?.weightKG ?? data.goal.targetWeightKG
    const exercises: PlannedExercise[] = split.items.map((item) => {
      const weight = StrengthModel.prescribedWeight(
        item.name,
        item.reps,
        data,
        bodyWeight,
      )
      return {
        id: newID(),
        name: item.name,
        targetSets: item.sets,
        targetReps: item.reps,
        targetWeightKG: Math.max(0, weight),
      }
    })
    return { id: newID(), date, splitName: split.name, exercises, status: 'planned' }
  },
}
