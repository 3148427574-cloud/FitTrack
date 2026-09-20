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