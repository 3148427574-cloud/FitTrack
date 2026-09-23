// 用 Mac 版 Swift 代码当 oracle：__fixtures__/oracle.json 里每个数字都是 Swift 算出来的，
// 这里断言 TS 实现逐值相等。「网页版和 Mac 版算出来一样」由此被机器验证，而不是靠眼看。
//
// 重新生成 fixture：cd scripts/oracle && swiftc -O -o /tmp/ftoracle \
//   ../../Sources/FitTrack/Models.swift ../../Sources/FitTrack/Engine.swift \
//   ../../Sources/FitTrack/RemindersSync.swift main.swift && /tmp/ftoracle > ../../src/__fixtures__/oracle.json

import { describe, expect, it } from 'vitest'

import { ICSExporter, WorkoutText } from './ics'
import {
  DietPlanner,
  StrengthModel,
  TrainingPlanner,
  baseTotal,
  bigThreeValue,
  calories,
  dailyCalorieAdjustment,
  defaultWeight,
  dietSuggestions,
  heightFactor,
  isBodyweight,
  nutritionForDietLog,
  summarizeDietLogsOnDate,
  totalCalories,
  type BigThreeLift,
} from './engine'
import {
  SEED_EXERCISES,
  SEED_FOODS,
  type AppData,
  type BigThreeMax,
  type Goal,
  type PlannedExercise,
  type PlannedWorkout,
  type UserProfile,
  type WorkoutSession,
} from './models'

import fixture from './__fixtures__/oracle.json'

// MARK: - 重建 oracle 的固定场景

const f = fixture as unknown as Record<string, any>

const profile: UserProfile = {
  sex: 'male',
  age: 25,
  heightCM: 175,
  activityLevel: 1.55,
  trainingDaysPerWeek: 4,
}

const goal: Goal = {
  type: 'bulk',
  targetWeightKG: 75,
  targetBodyFatPct: null,
  weeklyTargetDeltaKG: 0.25,
}

const bigThree: BigThreeMax = { benchKG: 100, squatKG: 140, deadliftKG: 180 }

/** 训练历史一律相对「现在」重建，跟 Swift 侧同一口径，30 天窗口永远对齐 */
function buildWorkouts(): WorkoutSession[] {
  const now = Date.now()
  return (f.workoutSpec as any[]).map((w) => ({
    id: `seed-${w.daysAgo}`,
    date: new Date(now - w.daysAgo * 86_400_000),
    splitName: w.split,
    exercises: w.exercises.map((e: any) => ({
      id: `seed-${e.name}`,
      name: e.name,
      sets: e.sets.map((s: any) => ({ reps: s.reps, weightKG: s.weightKG })),
    })),
    durationMin: 60,
    notes: '',
  }))
}

function baseData(): AppData {
  return {
    profile: { ...profile },
    goal: { ...goal },
    workouts: [],
    plannedWorkouts: [],
    bodyMetrics: [],
    foods: SEED_FOODS,
    exercises: SEED_EXERCISES,
    dietLogs: [],
    bigThree: null,
    coachNotes: null,
  }
}

const historyData: AppData = { ...baseData(), workouts: buildWorkouts() }

const scenarios: Record<string, AppData> = {
  emptyData: baseData(),
  manualAnchors: { ...baseData(), bigThree: { ...bigThree } },
  historyOnly: historyData,
  both: { ...historyData, bigThree: { ...bigThree } },
}

const exerciseNames = SEED_EXERCISES.map((e) => e.name)
const repList = [3, 5, 6, 8, 10, 12, 15, 20]
const bodyWeight = 75

/** fixture 里 BigThreeMax 是被 `if let` 过滤过的，只留非 nil 项 —— 比较时同样归一 */
function normalizeBigThree(m: BigThreeMax): Record<string, number> {
  const out: Record<string, number> = {}
  const lifts: [BigThreeLift, number | null | undefined][] = [
    ['bench', m.benchKG],
    ['squat', m.squatKG],
    ['deadlift', m.deadliftKG],
  ]
  for (const [k, v] of lifts) if (v != null) out[k] = v
  return out
}

// MARK: - 配重

describe('StrengthModel.prescribedWeight', () => {
  for (const label of Object.keys(scenarios)) {
    for (const name of exerciseNames) {
      it(`${label} / ${name} 各次数配重与 Swift 一致`, () => {
        const expected = f.prescribed[label][name]
        const actual: Record<string, number> = {}
        for (const reps of repList) {
          actual[String(reps)] = StrengthModel.prescribedWeight(
            name,
            reps,
            scenarios[label],
            bodyWeight,
          )
        }
        expect(actual).toEqual(expected)
      })
    }
  }
})

// MARK: - 基础公式

describe('StrengthModel 基础公式', () => {
  it('oneRepMax 逐值一致', () => {
    const actual: Record<string, number> = {}
    for (const w of [0, 40, 60, 80, 100, 132.5]) {
      for (const r of [0, 1, 3, 5, 8, 12, 20]) {
        actual[`${w.toFixed(1)}_${r}`] = StrengthModel.oneRepMax(w, r)
      }
    }
    expect(actual).toEqual(f.oneRepMax)
  })

  it('intensity 逐值一致', () => {
    const actual: Record<string, number> = {}
    for (const r of [0, 1, 3, 5, 6, 8, 10, 12, 15, 20]) {
      actual[String(r)] = StrengthModel.intensity(r)
    }
    expect(actual).toEqual(f.intensity)
  })

  it('roundToPlate 逐值一致（含 .5 与负数边界语义）', () => {
    const actual: Record<string, number> = {}
    for (const k of Object.keys(f.roundToPlate)) {
      const x = Number(k)
      actual[k] = StrengthModel.roundToPlate(x)
    }
    expect(actual).toEqual(f.roundToPlate)
  })
})

// MARK: - 默认起始重量 / 锚点

describe('默认起始重量', () => {
  it('23 个动作全部一致', () => {
    const actual: Record<string, number> = {}
    for (const name of exerciseNames) actual[name] = defaultWeight(name, bodyWeight)
    expect(actual).toEqual(f.defaultWeight)
  })
})

describe('三大项锚点', () => {
  for (const label of Object.keys(scenarios)) {
    it(`${label} 的 anchors 一致`, () => {
      expect(normalizeBigThree(StrengthModel.anchors(scenarios[label]))).toEqual(
        f.anchors[label],
      )
    })
  }

  it('historicalAnchors 一致（一年前的 PR 不该顶掉近期配重）', () => {
    expect(normalizeBigThree(StrengthModel.historicalAnchors(historyData.workouts))).toEqual(
      f.anchors.historicalFromHistory,
    )
  })

  it('anchor1RM 逐动作一致（无对应锚点时为 null）', () => {
    const actual: Record<string, number> = {}
    for (const name of exerciseNames) {
      actual[name] = StrengthModel.anchor1RM(name, scenarios.manualAnchors) ?? -1
    }
    expect(actual).toEqual(f.anchor1RM_manualAnchors)
  })
})

// MARK: - 1RM 历史查询

describe('1RM 历史查询', () => {
  it('best1RM 逐动作一致', () => {
    const actual: Record<string, number> = {}
    for (const name of exerciseNames) {
      actual[name] = StrengthModel.best1RM(name, historyData.workouts)
    }
    expect(actual).toEqual(f.best1RM)
  })

  it('prescription1RM（30 天窗口）逐动作一致', () => {
    const actual: Record<string, number> = {}
    for (const name of exerciseNames) {
      actual[name] = StrengthModel.prescription1RM(name, historyData.workouts)
    }
    expect(actual).toEqual(f.prescription1RM_30d)
  })
})

// MARK: - 卡路里

const calWorkoutExercises: PlannedExercise[] = [
  { id: '1', name: '杠铃卧推', targetSets: 4, targetReps: 8, targetWeightKG: 67.5 },
  { id: '2', name: '引体向上', targetSets: 3, targetReps: 8, targetWeightKG: 0 },
  { id: '3', name: '哑铃侧平举', targetSets: 3, targetReps: 15, targetWeightKG: 10 },
  { id: '4', name: '杠铃深蹲', targetSets: 5, targetReps: 5, targetWeightKG: 100 },
  { id: '5', name: '站姿提踵', targetSets: 4, targetReps: 15, targetWeightKG: 80 },
]

const calWorkout: PlannedWorkout = {
  id: 'cal',
  date: new Date(),
  splitName: '推',
  exercises: calWorkoutExercises,
  status: 'planned',
}

describe('卡路里估算', () => {
  for (const heightKey of Object.keys(f.calories)) {
    const h = Number(heightKey)
    const expected = f.calories[heightKey]

    it(`身高 ${h}cm：逐动作 + 合计 + 修正系数一致`, () => {
      const perExercise: Record<string, number> = {}
      const factors: Record<string, number> = {}
      for (const ex of calWorkoutExercises) {
        perExercise[ex.name] = calories(ex, 70, h)
        factors[ex.name] = heightFactor(ex.name, h)
      }
      expect({
        base: baseTotal(calWorkout, 70),
        total: totalCalories(calWorkout, 70, h),
        perExercise,
        factors,
      }).toEqual(expected)
    })
  }
})

// MARK: - 饮食

describe('DietPlanner.targets', () => {
  it('按每周目标计算并限制每日盈余/缺口', () => {
    expect(dailyCalorieAdjustment({ ...goal, type: 'bulk', weeklyTargetDeltaKG: 0.25 }))
      .toBeCloseTo(275)
    expect(dailyCalorieAdjustment({ ...goal, type: 'cut', weeklyTargetDeltaKG: 0.05 }))
      .toBe(-150)
    expect(dailyCalorieAdjustment({ ...goal, type: 'bulk', weeklyTargetDeltaKG: 2 }))
      .toBe(700)
    expect(dailyCalorieAdjustment({ ...goal, type: 'maintain', weeklyTargetDeltaKG: 1 }))
      .toBe(0)
  })

  it('增肌加、减脂减、维持不变，最低目标为 1200 千卡', () => {
    const tdee = 10 * 75 + 6.25 * profile.heightCM - 5 * profile.age + 5
    const dailyTdee = tdee * profile.activityLevel
    expect(DietPlanner.targets(profile, goal, 75).kcal).toBeCloseTo(dailyTdee + 275)
    expect(DietPlanner.targets(profile, { ...goal, type: 'cut' }, 75).kcal)
      .toBeCloseTo(dailyTdee - 275)
    expect(DietPlanner.targets(profile, { ...goal, type: 'maintain' }, 75).kcal)
      .toBeCloseTo(dailyTdee)
    expect(DietPlanner.targets({ ...profile, heightCM: 120, age: 90, activityLevel: 1.2 }, { ...goal, type: 'cut', weeklyTargetDeltaKG: 1 }, 30).kcal)
      .toBe(1200)
  })
})

describe('饮食日志营养', () => {
  const date = new Date('2026-09-23T12:00:00')
  const rice = SEED_FOODS.find((food) => food.name === '米饭(熟)')!

  it('旧日志按 foodName 回查，新日志优先使用快照', () => {
    const oldLog = { id: 'old', date, foodName: rice.name, amountG: 200 }
    expect(nutritionForDietLog(oldLog, SEED_FOODS)).toEqual({
      kcal: rice.kcalPer100g * 2,
      protein: rice.proteinPer100g * 2,
      carb: rice.carbPer100g * 2,
      fat: rice.fatPer100g * 2,
    })
    expect(nutritionForDietLog({ ...oldLog, id: 'new', kcal: 999, protein: 8, carb: 9, fat: 10 }, SEED_FOODS))
      .toEqual({ kcal: 999, protein: 8, carb: 9, fat: 10 })
  })

  it('只汇总指定日期', () => {
    const total = summarizeDietLogsOnDate([
      { id: 'a', date, foodName: rice.name, amountG: 100 },
      { id: 'b', date: new Date('2026-09-22T23:59:00'), foodName: rice.name, amountG: 100 },
      { id: 'c', date, foodName: '照片食物', amountG: 80, kcal: 120, protein: 10, carb: 12, fat: 3 },
    ], SEED_FOODS, date)
    expect(total).toEqual({
      kcal: rice.kcalPer100g + 120,
      protein: rice.proteinPer100g + 10,
      carb: rice.carbPer100g + 12,
      fat: rice.fatPer100g + 3,
    })
  })
})

describe('饮食建议', () => {
  const target = { kcal: 2200, protein: 150, carb: 260, fat: 70 }

  it('有较大缺口时提示分配热量并补蛋白碳水', () => {
    const text = dietSuggestions(target, { kcal: 1000, protein: 60, carb: 80, fat: 50 }).join(' ')
    expect(text).toContain('尚余约 1200 千卡')
    expect(text).toContain('蛋白质仍有明显缺口')
    expect(text).toContain('碳水仍偏少')
  })

  it('超出热量和脂肪时给出控制建议', () => {
    const text = dietSuggestions(target, { kcal: 2300, protein: 160, carb: 260, fat: 80 }).join(' ')
    expect(text).toContain('今日热量目标已达到')
    expect(text).toContain('脂肪已超出目标')
  })
})

describe('DietPlanner.sampleMealPlan', () => {
  it('示例餐单使用新的动态目标', () => {
    expect(DietPlanner.sampleMealPlan(profile, goal, 75, SEED_FOODS)).toEqual([
      '目标：2947 千卡 / 蛋白质 150g / 碳水 435g / 脂肪 68g',
      '第1餐：乳清蛋白粉 47g + 燕麦 165g + 橄榄油 17g',
      '第2餐：乳清蛋白粉 47g + 燕麦 165g + 橄榄油 17g',
      '第3餐：乳清蛋白粉 47g + 燕麦 165g + 橄榄油 17g',
      '第4餐：乳清蛋白粉 47g + 燕麦 165g + 橄榄油 17g',
    ])
  })

  it('空食物库给提示而不是崩', () => {
    expect(DietPlanner.sampleMealPlan(profile, goal, 75, [])).toEqual(
      f.mealPlan.emptyLibrary,
    )
  })
})

// MARK: - 拆分模板与生成计划

describe('TrainingPlanner.splits', () => {
  for (const d of [1, 2, 3, 4, 5, 6, 7]) {
    it(`每周 ${d} 天的模板一致`, () => {
      const actual = TrainingPlanner.splits(d).map((t) => ({
        name: t.name,
        items: t.items.map((i) => ({ name: i.name, sets: i.sets, reps: i.reps })),
      }))
      expect(actual).toEqual(f.splits[String(d)])
    })
  }
})

describe('TrainingPlanner.generatePlan', () => {
  const planDates = (f.planDates as string[]).map((s) => new Date(s))

  for (const days of [1, 2, 3, 4, 5, 6, 7]) {
    for (let offset = 0; offset < 7; offset++) {
      const weekday = planDates[offset].toLocaleDateString('en-US', { weekday: 'long' })
      it(`每周 ${days} 天 / 第 ${offset} 天(${weekday}) 的计划一致`, () => {
        const data: AppData = {
          ...scenarios.both,
          profile: { ...profile, trainingDaysPerWeek: days },
        }
        let n = 0
        const plan = TrainingPlanner.generatePlan(planDates[offset], data, () => `id-${n++}`)
        expect({
          splitName: plan.splitName,
          exercises: plan.exercises.map((e) => ({
            name: e.name,
            targetSets: e.targetSets,
            targetReps: e.targetReps,
            targetWeightKG: e.targetWeightKG,
          })),
        }).toEqual(f.generatedPlan[`${days}_${offset}`])
      })
    }
  }
})

// MARK: - 指定部位生成（网页版新增：胸/背/腿/自定义，不走按星期轮转）

describe('TrainingPlanner 指定部位生成', () => {
  const data: AppData = { ...scenarios.both, profile: { ...profile, trainingDaysPerWeek: 4 } }
  const planDate = new Date('2026-09-21T10:00:00')

  it('胸 / 背 / 腿 用各自的模板，并沿用所选名称', () => {
    const expected: [string, string[]][] = [
      ['胸', ['杠铃卧推', '上斜哑铃卧推', '站姿推举', '哑铃侧平举', '绳索下压', '仰卧臂屈伸']],
      ['背', ['硬拉', '引体向上', '杠铃划船', '面拉', '哑铃弯举', '锤式弯举']],
      ['腿', ['杠铃深蹲', '罗马尼亚硬拉', '腿举', '腿弯举', '站姿提踵']],
    ]
    for (const [focus, names] of expected) {
      let n = 0
      const plan = TrainingPlanner.generatePlan(planDate, data, () => `id-${n++}`, focus)
      expect(plan.splitName).toBe(focus)
      expect(plan.exercises.map((e) => e.name)).toEqual(names)
      expect(plan.status).toBe('planned')
    }
  })

  it('自定义：按关键词从动作库挑动作，多关节 4×8、孤立 3×12', () => {
    let n = 0
    const plan = TrainingPlanner.generatePlan(planDate, data, () => `id-${n++}`, '肩+三头')
    expect(plan.splitName).toBe('肩+三头')
    expect(plan.exercises.map((e) => `${e.name} ${e.targetSets}×${e.targetReps}`)).toEqual([
      '站姿推举 4×8',
      '哑铃侧平举 3×12',
      '面拉 3×12',
      '绳索下压 3×12',
      '仰卧臂屈伸 3×12',
    ])
    expect(plan.exercises.every((e) => e.targetWeightKG > 0)).toBe(true)
  })

  it('自定义挑不到动作时退回全身模板，名称仍用用户填的', () => {
    let n = 0
    const plan = TrainingPlanner.generatePlan(planDate, data, () => `id-${n++}`, '不存在的部位')
    expect(plan.splitName).toBe('不存在的部位')
    expect(plan.exercises.map((e) => e.name)).toEqual([
      '杠铃深蹲',
      '杠铃卧推',
      '杠铃划船',
      '站姿推举',
      '哑铃弯举',
      '绳索下压',
    ])
  })
})

// MARK: - 提醒 / .ics 文案

describe('WorkoutText', () => {
  for (const heightKey of Object.keys(f.workoutText)) {
    const h = Number(heightKey)
    it(`身高 ${h}cm 的备注逐字一致`, () => {
      expect(WorkoutText.note(calWorkout, 70, h)).toEqual(f.workoutText[heightKey])
    })
  }
})

describe('ICSExporter', () => {
  it('.ics 文本逐字一致（含 CRLF 与 UID）', () => {
    const w: PlannedWorkout = {
      id: '11111111-2222-3333-4444-555555555555',
      date: new Date('2026-09-20T12:00:00Z'),
      splitName: '推',
      exercises: calWorkoutExercises,
      status: 'planned',
    }
    expect(ICSExporter.ics([w], 70, 182.5)).toEqual(f.ics)
  })
})

// MARK: - 前置假设

describe('搬运假设', () => {
  it('自重动作只认引体向上', () => {
    expect(exerciseNames.filter(isBodyweight)).toEqual(['引体向上'])
  })

  it('种子数据条数与 Swift 版一致', () => {
    expect(SEED_EXERCISES).toHaveLength(23)
    expect(SEED_FOODS).toHaveLength(16)
  })

  it('anchorRatios 覆盖三大项自身（漏了会让卧推配重腰斩）', () => {
    for (const name of ['杠铃卧推', '杠铃深蹲', '硬拉']) {
      expect(StrengthModel.anchorRatios[name]?.ratio).toBe(1)
    }
    expect(StrengthModel.anchorRatios['杠铃卧推'].lift).toBe('bench')
    expect(StrengthModel.anchorRatios['杠铃深蹲'].lift).toBe('squat')
    expect(StrengthModel.anchorRatios['硬拉'].lift).toBe('deadlift')
  })

  it('bigThreeValue 对缺项返回 null', () => {
    expect(bigThreeValue({}, 'bench')).toBeNull()
    expect(bigThreeValue({ benchKG: 0 }, 'bench')).toBe(0)
  })
})
