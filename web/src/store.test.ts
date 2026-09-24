// 用 Mac 版 Swift 代码当 oracle：__fixtures__/patch.json 里每个用例都是 Swift 的
// AppStore.plannedChanges 跑出来的，这里断言 TS 实现逐值相等。
//
// patch.json 只存输出（changes + updated），输入在 scripts/oracle/patch/main.swift，
// 所以下面的用例表是照那份 Swift 抄过来的 —— 改一边要改另一边。
//
// 重新生成 fixture：cd scripts/oracle/patch && swiftc -O -o /tmp/ftpatch \
//   ../../../Sources/FitTrack/Models.swift ../../../Sources/FitTrack/Engine.swift \
//   ../../../Sources/FitTrack/AppStore.swift main.swift && /tmp/ftpatch > ../../src/__fixtures__/patch.json

import { describe, expect, it } from 'vitest'

import { AppStore } from './store'
import { decodeJSON, emptyAppData, encodeJSON } from './models'
import type {
  AIUpdatePayload,
  AppData,
  BigThreeMax,
  BigThreePatch,
  Goal,
  GoalPatch,
  PlanPatch,
  PlannedWorkout,
  ProfilePatch,
  UserProfile,
} from './models'

import fixture from './__fixtures__/patch.json'

type Fixture = Record<string, { changes: string[]; updated: Record<string, unknown> }>
const oracle = fixture as Fixture

// MARK: - 基准数据（对齐 main.swift 的 baseProfile / baseGoal / baseData）

function baseProfile(): UserProfile {
  return { sex: 'male', age: 25, heightCM: 175, activityLevel: 1.55, trainingDaysPerWeek: 4 }
}

function baseGoal(): Goal {
  return { type: 'bulk', targetWeightKG: 75, targetBodyFatPct: null, weeklyTargetDeltaKG: 0.25 }
}

function baseData(
  bigThree: BigThreeMax | null,
  bodyFat: number | null,
  notes: string[] | null,
): AppData {
  return {
    profile: baseProfile(),
    goal: { ...baseGoal(), targetBodyFatPct: bodyFat },
    workouts: [],
    plannedWorkouts: [],
    bodyMetrics: [],
    foods: [],
    exercises: [],
    dietLogs: [],
    bigThree,
    coachNotes: notes,
  }
}

const emptyBase = baseData(null, null, null)
const filledBase = baseData(
  { benchKG: 100, squatKG: 140, deadliftKG: 180 },
  20,
  ['膝盖有旧伤，深蹲不要上太大重量'],
)

function payload(o: {
  profile?: ProfilePatch | null
  goal?: GoalPatch | null
  bigThree?: BigThreePatch | null
  notes?: string[] | null
} = {}): AIUpdatePayload {
  return {
    profile: o.profile ?? null,
    goal: o.goal ?? null,
    bigThree: o.bigThree ?? null,
    notes: o.notes ?? null,
  }
}

const longNote = '很'.repeat(250)

// MARK: - 用例表（逐条对应 main.swift 的 cases）

interface Case {
  name: string
  payload: AIUpdatePayload
  data: AppData
}

const cases: Case[] = [
  { name: '空载荷', payload: payload(), data: emptyBase },

  // 逐字段越界 → 夹紧
  {
    name: 'profile_全部越界',
    payload: payload({
      profile: { age: 5, heightCM: 100, activityLevel: 1.6, trainingDaysPerWeek: 0 },
    }),
    data: emptyBase,
  },
  {
    name: 'profile_全部超上限',
    payload: payload({ profile: { age: 200, heightCM: 300, trainingDaysPerWeek: 9 } }),
    data: emptyBase,
  },

  // 身高一位小数 + 0.05 阈值
  {
    name: '身高_舍入到一位',
    payload: payload({ profile: { heightCM: 175.46 } }),
    data: emptyBase,
  },
  {
    name: '身高_阈值内不报变更',
    payload: payload({ profile: { heightCM: 175.04 } }),
    data: emptyBase,
  },
  {
    name: '身高_阈值外报变更',
    payload: payload({ profile: { heightCM: 175.06 } }),
    data: emptyBase,
  },

  // 活动系数吸附
  {
    name: '活动系数_吸附1.55',
    payload: payload({ profile: { activityLevel: 1.6 } }),
    data: emptyBase,
  },
  {
    name: '活动系数_吸附1.375',
    payload: payload({ profile: { activityLevel: 1.4 } }),
    data: emptyBase,
  },
  {
    name: '活动系数_同值不报',
    payload: payload({ profile: { activityLevel: 1.5504 } }),
    data: emptyBase,
  },

  // 性别归一
  { name: '性别_M', payload: payload({ profile: { sex: 'M' } }), data: emptyBase },
  { name: '性别_男', payload: payload({ profile: { sex: ' 男 ' } }), data: emptyBase },
  { name: '性别_Female', payload: payload({ profile: { sex: 'Female' } }), data: emptyBase },
  { name: '性别_女', payload: payload({ profile: { sex: '女' } }), data: emptyBase },
  { name: '性别_认不出', payload: payload({ profile: { sex: 'x' } }), data: emptyBase },
  { name: '性别_同为男不报', payload: payload({ profile: { sex: 'male' } }), data: emptyBase },

  // 目标类型归一
  { name: '目标_增肌', payload: payload({ goal: { type: '增肌' } }), data: filledBase },
  { name: '目标_减重', payload: payload({ goal: { type: '减重' } }), data: emptyBase },
  { name: '目标_MAINTAIN', payload: payload({ goal: { type: 'MAINTAIN' } }), data: emptyBase },
  { name: '目标_认不出', payload: payload({ goal: { type: 'zzz' } }), data: emptyBase },

  // 目标体重
  {
    name: '目标体重_下限',
    payload: payload({ goal: { targetWeightKG: 25 } }),
    data: emptyBase,
  },
  {
    name: '目标体重_上限',
    payload: payload({ goal: { targetWeightKG: 250 } }),
    data: emptyBase,
  },
  {
    name: '目标体重_阈值内',
    payload: payload({ goal: { targetWeightKG: 75.04 } }),
    data: emptyBase,
  },
  {
    name: '目标体重_阈值外',
    payload: payload({ goal: { targetWeightKG: 75.06 } }),
    data: emptyBase,
  },

  // 目标体脂：从「未设置」到有值
  {
    name: '目标体脂_从未设置',
    payload: payload({ goal: { targetBodyFatPct: 15 } }),
    data: emptyBase,
  },
  {
    name: '目标体脂_越界',
    payload: payload({ goal: { targetBodyFatPct: 99 } }),
    data: emptyBase,
  },
  {
    name: '目标体脂_阈值内',
    payload: payload({ goal: { targetBodyFatPct: 20.04 } }),
    data: filledBase,
  },
  {
    name: '目标体脂_阈值外',
    payload: payload({ goal: { targetBodyFatPct: 20.06 } }),
    data: filledBase,
  },

  // 每周增减：两位小数 + 0.005 阈值
  {
    name: '每周增减_负数夹到0',
    payload: payload({ goal: { weeklyTargetDeltaKG: -1 } }),
    data: emptyBase,
  },
  {
    name: '每周增减_超1夹到1',
    payload: payload({ goal: { weeklyTargetDeltaKG: 5 } }),
    data: emptyBase,
  },
  {
    name: '每周增减_舍入0.255',
    payload: payload({ goal: { weeklyTargetDeltaKG: 0.255 } }),
    data: emptyBase,
  },
  {
    name: '每周增减_舍入0.2551',
    payload: payload({ goal: { weeklyTargetDeltaKG: 0.2551 } }),
    data: emptyBase,
  },
  {
    name: '每周增减_0.251舍到0.25',
    payload: payload({ goal: { weeklyTargetDeltaKG: 0.251 } }),
    data: emptyBase,
  },

  // 三大项：夹紧 + 四舍五入到 2.5kg
  {
    name: '三大项_下限夹紧',
    payload: payload({ bigThree: { benchKG: 10 } }),
    data: emptyBase,
  },
  {
    name: '三大项_上限夹紧',
    payload: payload({ bigThree: { benchKG: 500 } }),
    data: emptyBase,
  },
  {
    name: '三大项_舍入到2.5',
    payload: payload({ bigThree: { benchKG: 102 } }),
    data: emptyBase,
  },
  {
    name: '三大项_舍入到103.75',
    payload: payload({ bigThree: { benchKG: 103.75 } }),
    data: emptyBase,
  },
  {
    name: '三大项_同值不报',
    payload: payload({ bigThree: { benchKG: 100.004 } }),
    data: filledBase,
  },
  {
    name: '三大项_只改一项',
    payload: payload({ bigThree: { squatKG: 145 } }),
    data: filledBase,
  },

  // 备注
  { name: '备注_单条', payload: payload({ notes: ['晚上训练，睡眠 7 小时'] }), data: emptyBase },
  {
    name: '备注_重复不重加',
    payload: payload({ notes: ['膝盖有旧伤，深蹲不要上太大重量'] }),
    data: filledBase,
  },
  {
    name: '备注_空串与空白',
    payload: payload({ notes: ['', '   ', '\n\t'] }),
    data: emptyBase,
  },
  { name: '备注_首尾空白裁掉', payload: payload({ notes: ['  早睡  '] }), data: emptyBase },
  { name: '备注_超长截断200', payload: payload({ notes: [longNote] }), data: emptyBase },
  {
    name: '备注_超过12条',
    payload: payload({ notes: Array.from({ length: 20 }, (_, i) => `偏好${i + 1}`) }),
    data: emptyBase,
  },
  {
    name: '备注_已有11条再加3条',
    payload: payload({ notes: ['新A', '新B', '新C'] }),
    data: baseData(
      null,
      null,
      Array.from({ length: 11 }, (_, i) => `旧${i + 1}`),
    ),
  },
]

// MARK: - 投影（对齐 main.swift 的 entry["updated"]）

function project(d: AppData): Record<string, unknown> {
  const goalOut: Record<string, unknown> = {
    type: d.goal.type,
    targetWeightKG: d.goal.targetWeightKG,
    weeklyTargetDeltaKG: d.goal.weeklyTargetDeltaKG,
  }
  if (d.goal.targetBodyFatPct != null) goalOut.targetBodyFatPct = d.goal.targetBodyFatPct

  const out: Record<string, unknown> = {
    profile: {
      sex: d.profile.sex,
      age: d.profile.age,
      heightCM: d.profile.heightCM,
      activityLevel: d.profile.activityLevel,
      trainingDaysPerWeek: d.profile.trainingDaysPerWeek,
    },
    goal: goalOut,
    coachNotes: d.coachNotes ?? [],
  }

  if (d.bigThree != null) {
    const m: Record<string, number> = {}
    if (d.bigThree.benchKG != null) m.benchKG = d.bigThree.benchKG
    if (d.bigThree.squatKG != null) m.squatKG = d.bigThree.squatKG
    if (d.bigThree.deadliftKG != null) m.deadliftKG = d.bigThree.deadliftKG
    out.bigThree = m
  }
  return out
}

// MARK: - 断言

describe('AppStore.plannedChanges 对齐 Swift oracle', () => {
  it('用例表与 fixture 条目一一对应', () => {
    const names = new Set(cases.map((c) => c.name))
    expect(names.size).toBe(cases.length)
    expect(new Set(Object.keys(oracle))).toEqual(names)
  })

  for (const c of cases) {
    it(c.name, () => {
      const expected = oracle[c.name]
      const r = AppStore.plannedChanges(c.payload, c.data)
      expect(r.changes).toEqual(expected.changes)
      expect(project(r.updated)).toEqual(expected.updated)
    })
  }
})

// MARK: - 今日计划变更（网页版新增，Mac 版没有对应实现，因此不进 Swift oracle）

const TODAY = new Date('2026-09-21T10:00:00')

function todayPlan(overrides: Partial<PlannedWorkout> = {}): PlannedWorkout {
  return {
    id: 'p1',
    date: TODAY,
    splitName: '胸',
    exercises: [
      { id: 'e1', name: '杠铃卧推', targetSets: 4, targetReps: 8, targetWeightKG: 60 },
      { id: 'e2', name: '上斜哑铃卧推', targetSets: 3, targetReps: 10, targetWeightKG: 27.5 },
    ],
    status: 'planned',
    ...overrides,
  }
}

function dataWith(
  plannedWorkouts: PlannedWorkout[],
  bigThree: BigThreeMax | null = null,
): AppData {
  return { ...baseData(bigThree, null, null), plannedWorkouts }
}

function planPayload(plan: PlanPatch): AIUpdatePayload {
  return { ...payload(), plan }
}

/** 动作的可断言形状：id 是随机生成的，不参与比较 */
function planShape(w: PlannedWorkout | undefined) {
  return w?.exercises.map((e) => ({
    name: e.name,
    targetSets: e.targetSets,
    targetReps: e.targetReps,
    targetWeightKG: e.targetWeightKG,
  }))
}

describe('plannedChanges 的今日计划变更', () => {
  it('换动作：按名字对齐，报新增与移除', () => {
    const r = AppStore.plannedChanges(
      planPayload({
        exercises: [
          { name: '杠铃卧推', targetSets: 4, targetReps: 8, targetWeightKG: 60 },
          // 没给重量：走三大项锚点推导（卧推 100 × 0.95 × 10 次的 0.75 强度 → 72.5）
          { name: '高位下拉', targetSets: 3, targetReps: 10 },
        ],
      }),
      dataWith([todayPlan()], { benchKG: 100 }),
      TODAY,
    )

    expect(r.changes).toEqual(['新增动作：高位下拉 3×10 72.5kg', '移除动作：上斜哑铃卧推'])
    expect(planShape(r.updated.plannedWorkouts[0])).toEqual([
      { name: '杠铃卧推', targetSets: 4, targetReps: 8, targetWeightKG: 60 },
      { name: '高位下拉', targetSets: 3, targetReps: 10, targetWeightKG: 72.5 },
    ])
  })

  it('改组数/次数/重量：只报变了的那一行', () => {
    const r = AppStore.plannedChanges(
      planPayload({
        exercises: [
          { name: '杠铃卧推', targetSets: 5, targetReps: 5, targetWeightKG: 70 },
          { name: '上斜哑铃卧推', targetSets: 3, targetReps: 10, targetWeightKG: 27.5 },
        ],
      }),
      dataWith([todayPlan()]),
      TODAY,
    )

    expect(r.changes).toEqual(['杠铃卧推：4×8 60.0kg → 5×5 70.0kg'])
  })

  it('越界值夹紧：组数封顶 10、次数兜底 1、重量封顶 400', () => {
    const r = AppStore.plannedChanges(
      planPayload({
        exercises: [{ name: '杠铃卧推', targetSets: 99, targetReps: 0, targetWeightKG: 9999 }],
      }),
      dataWith([todayPlan()]),
      TODAY,
    )

    expect(r.changes).toEqual([
      '杠铃卧推：4×8 60.0kg → 10×1 400.0kg',
      '移除动作：上斜哑铃卧推',
    ])
    expect(planShape(r.updated.plannedWorkouts[0])).toEqual([
      { name: '杠铃卧推', targetSets: 10, targetReps: 1, targetWeightKG: 400 },
    ])
  })

  it('自重动作重量清零；同名动作缺重量时沿用原配重', () => {
    const r = AppStore.plannedChanges(
      planPayload({
        exercises: [
          { name: '杠铃卧推', targetSets: 4, targetReps: 8 },
          { name: '引体向上', targetSets: 3, targetReps: 8, targetWeightKG: 50 },
        ],
      }),
      dataWith([todayPlan()]),
      TODAY,
    )

    expect(r.changes).toEqual(['新增动作：引体向上 3×8 自重', '移除动作：上斜哑铃卧推'])
    expect(planShape(r.updated.plannedWorkouts[0])).toEqual([
      { name: '杠铃卧推', targetSets: 4, targetReps: 8, targetWeightKG: 60 },
      { name: '引体向上', targetSets: 3, targetReps: 8, targetWeightKG: 0 },
    ])
  })

  it('只改名：动作原样保留', () => {
    const r = AppStore.plannedChanges(
      planPayload({ splitName: '胸+三头' }),
      dataWith([todayPlan()]),
      TODAY,
    )

    expect(r.changes).toEqual(['计划名称：胸 → 胸+三头'])
    expect(r.updated.plannedWorkouts[0].splitName).toBe('胸+三头')
    expect(planShape(r.updated.plannedWorkouts[0])).toEqual(planShape(todayPlan()))
  })

  it('同名不改：什么都不报，计划数组整份不换', () => {
    const same = todayPlan()
    const data = dataWith([same])
    const r = AppStore.plannedChanges(
      planPayload({ splitName: '胸', exercises: planShape(same) }),
      data,
      TODAY,
    )

    expect(r.changes).toEqual([])
    // 数组引用没换 → 落盘侧也就不会 commit，React 不会白重渲染
    expect(r.updated.plannedWorkouts).toBe(data.plannedWorkouts)
  })

  it('一天两条计划时按名字点名，另一条不动', () => {
    const chest = todayPlan()
    const legs = todayPlan({
      id: 'p2',
      splitName: '腿',
      exercises: [{ id: 'e9', name: '杠铃深蹲', targetSets: 4, targetReps: 8, targetWeightKG: 100 }],
    })

    const r = AppStore.plannedChanges(
      planPayload({
        splitName: '腿',
        exercises: [{ name: '腿举', targetSets: 3, targetReps: 12, targetWeightKG: 100 }],
      }),
      dataWith([chest, legs]),
      TODAY,
    )

    expect(r.changes).toEqual(['新增动作：腿举 3×12 100.0kg', '移除动作：杠铃深蹲'])
    expect(planShape(r.updated.plannedWorkouts[0])).toEqual(planShape(chest))
    expect(planShape(r.updated.plannedWorkouts[1])).toEqual([
      { name: '腿举', targetSets: 3, targetReps: 12, targetWeightKG: 100 },
    ])
  })

  it('今日没有待完成计划：不产生任何变更', () => {
    const yesterday = todayPlan({ id: 'p3', date: new Date('2026-09-20T10:00:00') })
    const r = AppStore.plannedChanges(
      planPayload({
        exercises: [{ name: '腿举', targetSets: 3, targetReps: 12, targetWeightKG: 100 }],
      }),
      dataWith([yesterday]),
      TODAY,
    )

    expect(r.changes).toEqual([])
    expect(r.updated.plannedWorkouts).toEqual([yesterday])
  })

  it('已完成 / 已跳过的今日计划不动：改了也不会同步回训练历史', () => {
    for (const status of ['completed', 'skipped'] as const) {
      const r = AppStore.plannedChanges(
        planPayload({
          exercises: [{ name: '腿举', targetSets: 3, targetReps: 12, targetWeightKG: 100 }],
        }),
        dataWith([todayPlan({ status })]),
        TODAY,
      )

      expect(r.changes).toEqual([])
    }
  })
})

describe('decodePayload 的 plan 字段', () => {
  it('坏条目被丢掉（非对象 / 没名字 / 重量不是数字），其余照常解析', () => {
    const p = AppStore.decodePayload(
      '{"plan":{"splitName":"背","exercises":[{"name":"高位下拉","targetSets":4,"targetReps":10,"targetWeightKG":"60"},{"targetSets":3},"x"]},"reason":"换动作"}',
    )

    expect(p?.plan).toEqual({
      splitName: '背',
      exercises: [{ name: '高位下拉', targetSets: 4, targetReps: 10, targetWeightKG: null }],
    })
    expect(p?.reason).toBe('换动作')
  })

  it('旧载荷（没有 plan 字段）照常解析', () => {
    const p = AppStore.decodePayload('{"goal":{"type":"cut"}}')
    expect(p?.plan).toBeUndefined()
    expect(p?.goal?.type).toBe('cut')
  })
})

describe('校准建议状态机', () => {
  const evaluation = {
    id: 'calibration-1',
    previousWindowStart: '2026-01-01',
    previousWindowEnd: '2026-01-07',
    currentWindowStart: '2026-01-08',
    currentWindowEnd: '2026-01-14',
    previousAverageKG: 70,
    currentAverageKG: 70,
    previousPointCount: 7,
    currentPointCount: 7,
    days: 7,
    goalType: 'bulk' as const,
    weeklyTargetDeltaKG: 0.25,
    actualWeeklyDelta: 0,
    deviation: -0.25,
    suggestedAdjustmentKcal: 150,
    appliedAdjustmentKcal: 0,
    status: 'suggested' as const,
    createdAt: new Date(2026, 0, 14),
    decidedAt: null,
  }

  it('总调整余量恰好 100 时接受，实际应用量可小于原建议且重复接受幂等', () => {
    const store = new AppStore()
    store.replaceData({
      ...emptyAppData(),
      dietCalibration: { currentAdjustmentKcal: 325, evaluations: [] },
    })
    expect(store.recordEvaluation(evaluation)).toBe(true)
    expect(store.recordEvaluation(evaluation)).toBe(false)
    expect(store.acceptCalibrationSuggestion(evaluation.id, new Date(2026, 0, 15))).toBe(true)
    expect(store.acceptCalibrationSuggestion(evaluation.id, new Date(2026, 0, 16))).toBe(false)
    expect(store.data.dietCalibration?.currentAdjustmentKcal).toBe(425)
    expect(store.data.dietCalibration?.evaluations[0]).toMatchObject({
      status: 'accepted', appliedAdjustmentKcal: 100,
    })
  })

  it('总调整余量小于 100 时拒绝接受并保持 suggested', () => {
    const store = new AppStore()
    store.replaceData({
      ...emptyAppData(),
      dietCalibration: { currentAdjustmentKcal: 350, evaluations: [evaluation] },
    })
    expect(store.acceptCalibrationSuggestion(evaluation.id, new Date(2026, 0, 15))).toBe(false)
    expect(store.data.dietCalibration?.currentAdjustmentKcal).toBe(350)
    expect(store.data.dietCalibration?.evaluations[0]).toMatchObject({
      status: 'suggested', appliedAdjustmentKcal: 0, decidedAt: null,
    })
  })
})

// MARK: - 落盘往返
//
// 刷新页面后数据从 localStorage 读回来，日期必须还是 Date（否则排序时 .date.getTime() 抛错，
// 概览页会整页崩）。encodeJSON 写出去的是 ISO 字符串，读回来要还原。

describe('落盘往返', () => {
  it('写出去再读回来，日期还原成 Date', () => {
    const d: AppData = {
      ...emptyAppData(),
      workouts: [
        {
          id: 'w1',
          date: new Date('2026-09-10T08:00:00Z'),
          splitName: '推',
          exercises: [{ id: 'e1', name: '杠铃卧推', sets: [{ reps: 8, weightKG: 60 }] }],
          durationMin: 60,
          notes: '',
        },
      ],
      bodyMetrics: [{ id: 'm1', date: new Date('2026-09-11T08:00:00Z'), weightKG: 72.5 }],
      plannedWorkouts: [
        {
          id: 'p1',
          date: new Date('2026-09-12T08:00:00Z'),
          splitName: '拉',
          exercises: [],
          status: 'planned',
        },
      ],
      dietLogs: [{ id: 'd1', date: new Date('2026-09-13T08:00:00Z'), foodName: '鸡胸肉', amountG: 200 }],
    }

    const roundTripped = decodeJSON<AppData>(encodeJSON(d))

    expect(roundTripped.workouts[0].date).toBeInstanceOf(Date)
    expect(roundTripped.bodyMetrics[0].date).toBeInstanceOf(Date)
    expect(roundTripped.plannedWorkouts[0].date).toBeInstanceOf(Date)
    expect(roundTripped.dietLogs[0].date).toBeInstanceOf(Date)
    // 排序不再抛错：这就是刷新后概览页崩掉的那一行
    expect(
      [...roundTripped.bodyMetrics].sort((a, b) => a.date.getTime() - b.date.getTime()),
    ).toHaveLength(1)
  })
})