// 导入导出格式的回归测试。
//
// 这里的期望值不是猜的：`scripts/oracle/roundtrip/main.swift` 把 Mac 版真实的
// fittrack.json 按 AppStore.save() 的配置重编码一遍，网页版必须逐字节相同。
// 完整比对要用真实数据（含个人信息，不进仓库），所以这里用合成数据把同几条规则钉住：
// 键排序、nil optional 整个键不写、冒号前的空格、空容器中间的空行、日期秒精度、字符串转义。

import { describe, expect, it } from 'vitest'

import {
  decodeJSON,
  encodeJSON,
  payloadHasAnyChange,
  toISO,
  type AppData,
  type WorkoutSession,
} from './models'

describe('encodeJSON 对齐 Foundation 的 prettyPrinted + sortedKeys', () => {
  it('键按字典序排出（不是插入序）', () => {
    expect(encodeJSON({ b: 1, a: 2 })).toBe('{\n  "a" : 2,\n  "b" : 1\n}')
  })

  it('冒号前留一个空格', () => {
    expect(encodeJSON({ a: 1 })).toBe('{\n  "a" : 1\n}')
  })

  it('空数组 / 空对象中间留一空行', () => {
    expect(encodeJSON([])).toBe('[\n\n]')
    expect(encodeJSON({})).toBe('{\n\n}')
    expect(encodeJSON({ a: [] })).toBe('{\n  "a" : [\n\n  ]\n}')
    expect(encodeJSON({ a: {} })).toBe('{\n  "a" : {\n\n  }\n}')
    expect(encodeJSON({ a: [1] })).toBe('{\n  "a" : [\n    1\n  ]\n}')
  })

  it('嵌套缩进两级空格', () => {
    expect(encodeJSON({ a: { b: [1, 2] } })).toBe(
      '{\n  "a" : {\n    "b" : [\n      1,\n      2\n    ]\n  }\n}',
    )
  })

  it('null / undefined 的键整个不写（Swift Optional 的 encodeIfPresent）', () => {
    expect(encodeJSON({ a: 1, b: null, c: undefined })).toBe('{\n  "a" : 1\n}')
    expect(encodeJSON({ a: { b: null } })).toBe('{\n  "a" : {\n\n  }\n}')
  })

  it('false 与 0 要留住，不能和 null 一样被丢掉', () => {
    expect(encodeJSON({ a: false, b: 0, c: '' })).toBe(
      '{\n  "a" : false,\n  "b" : 0,\n  "c" : ""\n}',
    )
  })

  it('日期写成秒精度 ISO8601，不带毫秒和引号外的东西', () => {
    expect(encodeJSON({ date: new Date('2026-09-20T07:37:07.123Z') })).toBe(
      '{\n  "date" : "2026-09-20T07:37:07Z"\n}',
    )
    expect(toISO(new Date('2026-09-20T07:37:07Z'))).toBe('2026-09-20T07:37:07Z')
  })

  it('字符串转义与 Foundation 一致（含斜杠）', () => {
    expect(encodeJSON({ a: 'x/y' })).toBe('{\n  "a" : "x\\/y"\n}')
    expect(encodeJSON({ a: 'q"q' })).toBe('{\n  "a" : "q\\"q"\n}')
    expect(encodeJSON({ a: 'b\\b' })).toBe('{\n  "a" : "b\\\\b"\n}')
    expect(encodeJSON({ a: '\n\t\r' })).toBe('{\n  "a" : "\\n\\t\\r"\n}')
    expect(encodeJSON({ a: '\b\f' })).toBe('{\n  "a" : "\\b\\f"\n}')
    expect(encodeJSON({ a: '\u000b\u0000\u001f' })).toBe(
      '{\n  "a" : "\\u000b\\u0000\\u001f"\n}',
    )
  })

  it('中文与 emoji 原样写 UTF-8，不转义', () => {
    expect(encodeJSON({ a: '中文🏋️' })).toBe('{\n  "a" : "中文🏋️"\n}')
  })
})

describe('decodeJSON', () => {
  it('只把名为 date 的键还原成 Date，内容里像日期的字符串不动', () => {
    const text = '{"date":"2026-09-20T07:37:07Z","note":"2026-09-20T07:37:07Z","nested":[{"date":"2026-01-02T03:04:05Z"}]}'
    const parsed = decodeJSON<any>(text)
    expect(parsed.date).toBeInstanceOf(Date)
    expect(parsed.nested[0].date).toBeInstanceOf(Date)
    expect(parsed.note).toBe('2026-09-20T07:37:07Z')
  })

  it('扩展日期白名单字段也还原成 Date', () => {
    const parsed = decodeJSON<any>('{"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z","deletedAt":"2026-01-03T00:00:00Z","evaluatedAt":"2026-01-04T00:00:00Z","decidedAt":"2026-01-05T00:00:00Z"}')
    expect(parsed.createdAt).toBeInstanceOf(Date)
    expect(parsed.updatedAt).toBeInstanceOf(Date)
    expect(parsed.deletedAt).toBeInstanceOf(Date)
    expect(parsed.evaluatedAt).toBeInstanceOf(Date)
    expect(parsed.decidedAt).toBeInstanceOf(Date)
  })

  it('DietEvaluation 窗口字段往返后仍为本地自然日字符串', () => {
    const windows = {
      previousWindowStart: '2026-01-01',
      previousWindowEnd: '2026-01-07',
      currentWindowStart: '2026-01-08',
      currentWindowEnd: '2026-01-14',
    }
    const parsed = decodeJSON<typeof windows>(encodeJSON(windows))
    expect(parsed).toEqual(windows)
    for (const value of Object.values(parsed)) expect(value).not.toBeInstanceOf(Date)
  })

  it('不是日期的字符串留在字符串里', () => {
    expect(decodeJSON<any>('{"date":"not-a-date"}').date).toBe('not-a-date')
  })
})

describe('payloadHasAnyChange 认得今日计划变更', () => {
  it('只有 plan（改名或带动作）也算一次改动', () => {
    expect(payloadHasAnyChange({ plan: { splitName: '胸' } })).toBe(true)
    expect(payloadHasAnyChange({ plan: { exercises: [{ name: '高位下拉' }] } })).toBe(true)
  })

  it('空 plan / 无名动作用户点不出「应用」', () => {
    expect(payloadHasAnyChange({ plan: {} })).toBe(false)
    expect(payloadHasAnyChange({ plan: { exercises: [] } })).toBe(false)
    expect(payloadHasAnyChange({ plan: { exercises: [{ name: '  ' }] } })).toBe(false)
  })
})

describe('导出 / 导入往返', () => {
  const session: WorkoutSession = {
    id: 'w1',
    date: new Date('2026-09-17T10:00:00Z'),
    splitName: '推',
    exercises: [
      { id: 'e1', name: '杠铃卧推', sets: [{ reps: 8, weightKG: 80 }], rpe: null },
      { id: 'e2', name: '引体向上', sets: [{ reps: 8, weightKG: 0 }] },
    ],
    durationMin: 60,
    notes: '',
  }

  const data: AppData = {
    profile: { sex: 'male', age: 25, heightCM: 175, activityLevel: 1.55, trainingDaysPerWeek: 4 },
    goal: { type: 'bulk', targetWeightKG: 75, targetBodyFatPct: null, weeklyTargetDeltaKG: 0.25 },
    workouts: [session],
    plannedWorkouts: [],
    bodyMetrics: [],
    foods: [],
    exercises: [],
    dietLogs: [],
    bigThree: { benchKG: 100, squatKG: null, deadliftKG: 180 },
    coachNotes: null,
  }

  it('AppData 编码后能原样解回来', () => {
    const back = decodeJSON<AppData>(encodeJSON(data))
    expect(back.workouts[0].date).toEqual(session.date)
    expect(back.workouts[0].exercises[1].name).toBe('引体向上')
    expect(back.goal.type).toBe('bulk')
    // 缺席的键解回来是 undefined（等价于 Swift 的 nil），不是 null
    expect(back.bigThree?.squatKG).toBeUndefined()
    expect(back.bigThree?.benchKG).toBe(100)
  })

  it('nil optional 写成缺席而不是 null（Mac 版才解得回来）', () => {
    const text = encodeJSON(data)
    expect(text).not.toContain('"rpe"')
    expect(text).not.toContain('"targetBodyFatPct"')
    expect(text).not.toContain('"coachNotes"')
    expect(text).not.toContain('"squatKG"')
    // 字段值真的是 null 和值真的缺失，在 JSON 里必须长得不一样
    expect(text).toContain('"benchKG" : 100')
  })

  it('导出再导入再导出，文本稳定（幂等）', () => {
    const once = encodeJSON(data)
    const twice = encodeJSON(decodeJSON<AppData>(once))
    expect(twice).toBe(once)
  })
})
