import { beforeEach, describe, expect, it, vi } from 'vitest'

import { planFullRestore, previewFullBackup } from './importer'
import { CURRENT_SCHEMA_VERSION, decodeJSON, emptyAppData, encodeJSON, SEED_EXERCISES, SEED_FOODS, type AppData } from './models'
import { AppStore } from './store'

const IDS = {
  workout: '11111111-1111-4111-8111-111111111111',
  exerciseEntry: '22222222-2222-4222-8222-222222222222',
  plan: '33333333-3333-4333-8333-333333333333',
  plannedExercise: '44444444-4444-4444-8444-444444444444',
  metric: '55555555-5555-4555-8555-555555555555',
  food: '66666666-6666-4666-8666-666666666666',
  exercise: '77777777-7777-4777-8777-777777777777',
  diet: '88888888-8888-4888-8888-888888888888',
  chat: '99999999-9999-4999-8999-999999999999',
  evaluation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
}

function fullData(): AppData {
  return {
    ...emptyAppData(),
    createdAt: new Date('2026-01-01T01:02:03Z'),
    updatedAt: new Date('2026-02-01T01:02:03Z'),
    profile: { sex: 'female', age: 30, heightCM: 165, activityLevel: 1.375, trainingDaysPerWeek: 3 },
    goal: { type: 'cut', targetWeightKG: 60, targetBodyFatPct: 20, weeklyTargetDeltaKG: 0.3 },
    workouts: [{ id: IDS.workout, date: new Date('2026-02-02T01:00:00Z'), splitName: '推', exercises: [{ id: IDS.exerciseEntry, name: '卧推', sets: [{ reps: 8, weightKG: 50 }], rpe: 8 }], durationMin: 55, notes: '好' }],
    plannedWorkouts: [{ id: IDS.plan, date: new Date('2026-02-03T01:00:00Z'), splitName: '拉', exercises: [{ id: IDS.plannedExercise, name: '划船', targetSets: 3, targetReps: 10, targetWeightKG: 40 }], status: 'planned' }],
    bodyMetrics: [{ id: IDS.metric, date: new Date('2026-02-04T01:00:00Z'), weightKG: 62, bodyFatPct: 21 }],
    foods: [{ id: IDS.food, name: '测试食物', kcalPer100g: 100, proteinPer100g: 10, carbPer100g: 5, fatPer100g: 2 }],
    exercises: [{ id: IDS.exercise, name: '测试动作', muscleGroup: '背', equipment: '杠铃', isBodyweight: false }],
    dietLogs: [{ id: IDS.diet, date: new Date('2026-02-05T01:00:00Z'), foodName: '测试食物', amountG: 150, foodId: IDS.food, kcal: 150, protein: 15, carb: 7.5, fat: 3, source: 'manual' }],
    bigThree: { benchKG: 80, squatKG: 100, deadliftKG: 120 },
    coachNotes: ['测试备注'],
  }
}

function backup(data = fullData(), version: number | null = CURRENT_SCHEMA_VERSION): string {
  const value: Record<string, unknown> = { ...data, chat: [{ id: IDS.chat, role: 'user', content: '你好' }] }
  if (version == null) delete value.schemaVersion
  else value.schemaVersion = version
  return encodeJSON(value)
}

function evaluation() {
  return {
    id: IDS.evaluation,
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
    suggestedAdjustmentKcal: 100,
    appliedAdjustmentKcal: 0,
    status: 'suggested' as const,
    createdAt: new Date('2026-01-14T08:00:00Z'),
    decidedAt: null,
  }
}

describe('完整备份解析与迁移', () => {
  it('无版本按 v1 读取并升级到当前版本', () => {
    const preview = previewFullBackup(backup(fullData(), null))!
    expect(preview.sourceVersion).toBe(1)
    expect(preview.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(preview.data?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('真实缺字段 v1 迁移集合，且与历史追加 JSON 区分', () => {
    const legacy = {
      profile: fullData().profile,
      goal: fullData().goal,
      workouts: [],
    }
    const preview = previewFullBackup(encodeJSON(legacy))!
    expect(preview.sourceVersion).toBe(1)
    expect(preview.valid).toBe(true)
    expect(preview.data?.workouts).toEqual([])
    expect(preview.data?.plannedWorkouts).toEqual([])
    expect(preview.data?.foods).toEqual(SEED_FOODS)
    expect(preview.data?.exercises).toEqual(SEED_EXERCISES)
    expect(previewFullBackup(encodeJSON({ workouts: [] }))).toBeNull()
  })

  it('显式空 foods/exercises 保持为空，缺 profile/goal 阻断', () => {
    const value = decodeJSON<Record<string, unknown>>(backup())
    value.foods = []
    value.exercises = []
    expect(previewFullBackup(encodeJSON(value))?.data).toMatchObject({ foods: [], exercises: [] })
    delete value.profile
    const blocked = previewFullBackup(encodeJSON(value))!
    expect(blocked.valid).toBe(false)
    expect(blocked.issues.some((issue) => issue.path === 'profile')).toBe(true)
  })

  it('旧备份缺少新增字段时写入标准默认值，显式坏值仍跳过条目', () => {
    const legacy = decodeJSON<Record<string, unknown>>(backup())
    delete (legacy.workouts as Record<string, unknown>[])[0].notes
    delete (legacy.plannedWorkouts as Record<string, unknown>[])[0].status
    delete (legacy.exercises as Record<string, unknown>[])[0].isBodyweight
    const migrated = previewFullBackup(encodeJSON(legacy))!
    expect(migrated.data?.workouts[0].notes).toBe('')
    expect(migrated.data?.plannedWorkouts[0].status).toBe('planned')
    expect(migrated.data?.exercises[0].isBodyweight).toBe(false)

    const invalid = decodeJSON<Record<string, unknown>>(backup())
    ;(invalid.workouts as Record<string, unknown>[])[0].notes = null
    ;(invalid.plannedWorkouts as Record<string, unknown>[])[0].status = 'unknown'
    ;(invalid.exercises as Record<string, unknown>[])[0].isBodyweight = 'false'
    const rejected = previewFullBackup(JSON.stringify(invalid))!
    expect(rejected.data?.workouts).toEqual([])
    expect(rejected.data?.plannedWorkouts).toEqual([])
    expect(rejected.data?.exercises).toEqual([])
    expect(rejected.skipped).toBe(3)
  })

  it('当前完整备份 roundtrip 恢复所有字段、chat、日期和 DietLog 快照', () => {
    const preview = previewFullBackup(backup())!
    expect(preview.valid).toBe(true)
    expect(preview.counts).toEqual({ workouts: 1, plannedWorkouts: 1, bodyMetrics: 1, foods: 1, exercises: 1, dietLogs: 1, dietEvaluations: 0, chat: 1 })
    expect(preview.data).toEqual(fullData())
    expect(preview.data?.createdAt).toBeInstanceOf(Date)
    expect(preview.data?.dietLogs[0]).toMatchObject({ id: IDS.diet, kcal: 150, protein: 15, carb: 7.5, fat: 3 })
  })

  it('未来版本拒绝恢复', () => {
    const preview = previewFullBackup(backup(fullData(), CURRENT_SCHEMA_VERSION + 1))!
    expect(preview.valid).toBe(false)
    expect(preview.issues.some((issue) => issue.path === 'schemaVersion')).toBe(true)
  })

  it('迁移 Swift 旧评估别名为当前字段和本地自然日字符串', () => {
    const old = evaluation() as Record<string, unknown>
    old.earliestWindowStart = old.previousWindowStart
    old.earliestWindowEnd = old.previousWindowEnd
    old.latestWindowStart = old.currentWindowStart
    old.latestWindowEnd = old.currentWindowEnd
    old.targetWeeklyDeltaKG = old.weeklyTargetDeltaKG
    old.actualWeeklyDeltaKG = old.actualWeeklyDelta
    old.deviationKGPerWeek = old.deviation
    for (const key of ['previousWindowStart', 'previousWindowEnd', 'currentWindowStart', 'currentWindowEnd', 'weeklyTargetDeltaKG', 'actualWeeklyDelta', 'deviation']) delete old[key]
    const raw = decodeJSON<Record<string, unknown>>(backup())
    raw.dietCalibration = { currentAdjustmentKcal: 0, evaluations: [old] }
    const preview = previewFullBackup(encodeJSON(raw))!
    expect(preview.valid).toBe(true)
    const expected = evaluation()
    delete (expected as Partial<typeof expected>).decidedAt
    expect(preview.data?.dietCalibration?.evaluations[0]).toMatchObject(expected)
    expect(preview.data?.dietCalibration?.evaluations[0].currentWindowEnd).toBe('2026-01-14')
  })

  it('currentAdjustmentKcal 仅允许 [-700, 700]，超界为 blocking', () => {
    for (const value of [-700, 700]) {
      const raw = decodeJSON<Record<string, unknown>>(backup())
      raw.dietCalibration = { currentAdjustmentKcal: value, evaluations: [] }
      expect(previewFullBackup(encodeJSON(raw))?.valid).toBe(true)
    }
    for (const value of [-701, 701]) {
      const raw = decodeJSON<Record<string, unknown>>(backup())
      raw.dietCalibration = { currentAdjustmentKcal: value, evaluations: [] }
      const preview = previewFullBackup(encodeJSON(raw))!
      expect(preview.valid).toBe(false)
      expect(preview.data).toBeNull()
      expect(preview.issues).toContainEqual({ path: 'dietCalibration', message: 'currentAdjustmentKcal 超出 [-700, 700]' })
    }
  })

  it('坏单条和大小写重复 id 跳过并报告，Foundation UUID 可用且归一为小写', () => {
    const data = fullData()
    const oldLog = { id: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', date: new Date('2026-02-06T01:00:00Z'), foodName: '旧记录', amountG: 100 }
    const raw = decodeJSON<Record<string, unknown>>(backup({ ...data, dietLogs: [oldLog, { ...oldLog, id: oldLog.id.toLowerCase() }, { ...oldLog, id: 'bad-id' }] }))
    const preview = previewFullBackup(encodeJSON(raw))!
    expect(preview.valid).toBe(true)
    expect(preview.data?.dietLogs).toHaveLength(1)
    expect(preview.data?.dietLogs[0].id).toBe(oldLog.id.toLowerCase())
    expect(preview.data?.dietLogs[0].kcal).toBeUndefined()
    expect(preview.skipped).toBe(2)
  })

  it('整数约束、嵌套重复 ID 与 Chat 可选字段类型均校验', () => {
    for (const field of ['age', 'trainingDaysPerWeek'] as const) {
      const invalid = fullData()
      invalid.profile[field] = 3.5
      expect(previewFullBackup(backup(invalid))?.issues.some((issue) => issue.path === 'profile')).toBe(true)
    }
    const invalidReps = fullData()
    invalidReps.workouts[0].exercises[0].sets[0].reps = 8.5
    expect(previewFullBackup(backup(invalidReps))?.data?.workouts).toEqual([])
    for (const field of ['targetSets', 'targetReps'] as const) {
      const invalid = fullData()
      invalid.plannedWorkouts[0].exercises[0][field] = 2.5
      expect(previewFullBackup(backup(invalid))?.data?.plannedWorkouts).toEqual([])
    }

    const nested = fullData()
    nested.workouts[0].exercises.push({ ...nested.workouts[0].exercises[0], id: IDS.exerciseEntry.toUpperCase() })
    nested.plannedWorkouts[0].exercises.push({ ...nested.plannedWorkouts[0].exercises[0] })
    const nestedPreview = previewFullBackup(backup(nested))!
    expect(nestedPreview.data?.workouts).toEqual([])
    expect(nestedPreview.data?.plannedWorkouts).toEqual([])

    const raw = decodeJSON<Record<string, unknown>>(backup())
    raw.chat = [{ id: IDS.chat, role: 'user', content: 'x', proposalResult: [1] }]
    const chatPreview = previewFullBackup(encodeJSON(raw))!
    expect(chatPreview.chat).toEqual([])
    expect(chatPreview.skipped).toBe(1)
  })

  it('非数组集合是 blocking，不生成可恢复数据', () => {
    const raw = decodeJSON<Record<string, unknown>>(backup())
    raw.workouts = {}
    const preview = previewFullBackup(encodeJSON(raw))!
    expect(preview.valid).toBe(false)
    expect(preview.data).toBeNull()
    expect(preview.issues).toContainEqual({ path: 'workouts', message: '必须是数组' })
  })
})

describe('完整备份合并', () => {
  it('合并前按小写 ID 去重本地数组，保留第一条并计 ignored', () => {
    const local = fullData()
    local.foods = [
      { ...local.foods[0], name: '第一条' },
      { ...local.foods[0], id: local.foods[0].id.toUpperCase(), name: '重复条' },
    ]
    const raw = decodeJSON<Record<string, unknown>>(backup())
    raw.foods = []
    const plan = planFullRestore(previewFullBackup(encodeJSON(raw))!, local, [], 'merge', 'local')
    expect(plan.data.foods).toEqual([{ ...local.foods[0], name: '第一条' }])
    expect(plan.stats.ignored).toBeGreaterThanOrEqual(1)
  })

  it('同一备份重复 merge 幂等', () => {
    const preview = previewFullBackup(backup())!
    const first = planFullRestore(preview, emptyAppData(), [], 'merge', 'backup')
    const second = planFullRestore(preview, first.data, first.chat, 'merge', 'backup')
    expect(second.data).toEqual(first.data)
    expect(second.chat).toEqual(first.chat)
    expect(second.stats.added).toBe(0)
  })

  it('冲突策略分别保留本地或使用备份，单值配置遵循相同策略', () => {
    const local = fullData()
    local.profile = { ...local.profile, age: 50 }
    local.foods = [{ ...local.foods[0], name: '本地食物' }]
    const preview = previewFullBackup(backup())!
    const kept = planFullRestore(preview, local, [], 'merge', 'local')
    const replaced = planFullRestore(preview, local, [], 'merge', 'backup')
    expect(kept.data.profile.age).toBe(50)
    expect(kept.data.foods[0].name).toBe('本地食物')
    expect(replaced.data.profile.age).toBe(30)
    expect(replaced.data.foods[0].name).toBe('测试食物')
  })

  it('结构化比较忽略键顺序并统一 optional 缺失/null', () => {
    const preview = previewFullBackup(backup())!
    const local = fullData()
    local.foods = [{ fatPer100g: 2, carbPer100g: 5, proteinPer100g: 10, kcalPer100g: 100, name: '测试食物', id: IDS.food }]
    local.dietLogs = [{ ...local.dietLogs[0], imageName: null }]
    const plan = planFullRestore(preview, local, [{ content: '你好', role: 'user', id: IDS.chat }], 'merge', 'backup')
    expect(plan.stats.updated).toBe(0)
    expect(plan.data.foods[0]).toBe(local.foods[0])
  })

  it('单值按 presence 与相等性逐项统计，缺 optional 不覆盖本地', () => {
    const raw = decodeJSON<Record<string, unknown>>(backup())
    delete raw.bigThree
    delete raw.coachNotes
    delete raw.updatedAt
    const preview = previewFullBackup(encodeJSON(raw))!
    const local = fullData()
    local.profile = { ...local.profile, age: 50 }
    local.bigThree = { benchKG: 200 }
    local.coachNotes = ['本地']
    local.createdAt = new Date('2025-01-01T00:00:00Z')
    local.updatedAt = new Date('2025-02-01T00:00:00Z')
    const plan = planFullRestore(preview, local, [], 'merge', 'backup')
    expect(plan.data.profile.age).toBe(30)
    expect(plan.data.goal).toEqual(local.goal)
    expect(plan.data.bigThree).toEqual({ benchKG: 200 })
    expect(plan.data.coachNotes).toEqual(['本地'])
    expect(plan.stats.updated).toBe(1)
    expect(plan.stats.ignored).toBe(10)
    expect(plan.data.createdAt).toEqual(local.createdAt)
    expect(plan.data.updatedAt).toEqual(local.updatedAt)
  })

  it('replace 保留备份时间戳，merge 仅用非 null 的备份 updatedAt 覆盖', () => {
    const preview = previewFullBackup(backup())!
    const local = emptyAppData()
    local.createdAt = new Date('2025-01-01T00:00:00Z')
    local.updatedAt = new Date('2025-02-01T00:00:00Z')
    const replaced = planFullRestore(preview, local, [], 'replace', 'backup')
    const merged = planFullRestore(preview, local, [], 'merge', 'backup')
    expect(replaced.data.createdAt).toEqual(fullData().createdAt)
    expect(replaced.data.updatedAt).toEqual(fullData().updatedAt)
    expect(merged.data.createdAt).toEqual(local.createdAt)
    expect(merged.data.updatedAt).toEqual(fullData().updatedAt)

    const raw = decodeJSON<Record<string, unknown>>(backup())
    raw.updatedAt = null
    const nullPreview = previewFullBackup(JSON.stringify(raw))!
    expect(nullPreview.presentFields.has('updatedAt')).toBe(true)
    expect(planFullRestore(nullPreview, local, [], 'merge', 'backup').data.updatedAt).toEqual(local.updatedAt)
  })
})

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('Store 恢复事务与空库', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage())
  })

  it('首次启动补种子，已保存 [] 的空库在 constructor/reload 都保留', () => {
    const fresh = new AppStore()
    expect(fresh.data.foods.length).toBeGreaterThan(0)
    localStorage.setItem('fittrack.data', encodeJSON(emptyAppData()))
    const saved = new AppStore()
    expect(saved.data.foods).toEqual([])
    expect(saved.data.exercises).toEqual([])
    saved.reload()
    expect(saved.data.foods).toEqual([])
  })

  it('恢复写失败不改内存', () => {
    const app = new AppStore()
    const before = app.data
    const preview = previewFullBackup(backup())!
    const plan = planFullRestore(preview, app.data, app.chatMessages, 'replace', 'backup')
    const original = localStorage.setItem.bind(localStorage)
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === 'fittrack.data') throw new Error('quota')
      original(key, value)
    })
    expect(() => app.applyRestore(plan)).toThrow('恢复已取消')
    expect(app.data).toBe(before)
  })

  it('成功恢复前保存可重新解析的完整快照', () => {
    const app = new AppStore()
    app.replaceData({ ...emptyAppData(), profile: { ...emptyAppData().profile, age: 42 } })
    const preview = previewFullBackup(backup())!
    app.applyRestore(planFullRestore(preview, app.data, app.chatMessages, 'replace', 'backup'))
    const snapshot = app.getRestoreBackupJSON()
    expect(snapshot).not.toBeNull()
    expect(previewFullBackup(snapshot!)?.data?.profile.age).toBe(42)
  })
})
