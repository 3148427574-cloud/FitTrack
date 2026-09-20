// AI 提议变更（AppStore.plannedChanges）的 oracle：把一堆边界载荷喂给 Swift 版，
// 打印变更摘要与改后的数据，供网页版 store.test.ts 逐值比对。
//
// 这一块全是夹紧与阈值（年龄 10...90、身高 ±0.05 才认、活动系数吸附档位、备注去重截断…），
// 手写期望值容易抄错，所以让 Swift 版自己说。
//
// 重新生成：swiftc -O -o /tmp/ftpatch ../../../Sources/FitTrack/Models.swift \
//   ../../../Sources/FitTrack/Engine.swift ../../../Sources/FitTrack/AppStore.swift main.swift
//   && /tmp/ftpatch > ../../src/__fixtures__/patch.json

import Foundation

// MARK: - 基准数据

func baseProfile() -> UserProfile {
    UserProfile(sex: "male", age: 25, heightCM: 175, activityLevel: 1.55, trainingDaysPerWeek: 4)
}

func baseGoal() -> Goal {
    Goal(type: .bulk, targetWeightKG: 75, targetBodyFatPct: nil, weeklyTargetDeltaKG: 0.25)
}

/// 两个基准：一个没填三大项、没填备注；一个都填了，用来测「同值不重复报变更」
func baseData(bigThree: BigThreeMax?, bodyFat: Double?, notes: [String]?) -> AppData {
    var d = AppData()
    d.profile = baseProfile()
    d.goal = baseGoal()
    d.goal.targetBodyFatPct = bodyFat
    d.bigThree = bigThree
    d.coachNotes = notes
    return d
}

let emptyBase = baseData(bigThree: nil, bodyFat: nil, notes: nil)
let filledBase = baseData(
    bigThree: BigThreeMax(benchKG: 100, squatKG: 140, deadliftKG: 180),
    bodyFat: 20,
    notes: ["膝盖有旧伤，深蹲不要上太大重量"])

// MARK: - 场景

struct Case {
    let name: String
    let payload: AIUpdatePayload
    let data: AppData
}

func payload(
    profile: AIUpdatePayload.ProfilePatch? = nil, goal: AIUpdatePayload.GoalPatch? = nil,
    bigThree: AIUpdatePayload.BigThreePatch? = nil, notes: [String]? = nil
) -> AIUpdatePayload {
    AIUpdatePayload(profile: profile, goal: goal, bigThree: bigThree, notes: notes)
}

let longNote = String(repeating: "很", count: 250)

var cases: [Case] = [
    Case(name: "空载荷", payload: payload(), data: emptyBase),

    // 逐字段越界 → 夹紧
    Case(name: "profile_全部越界", payload: payload(profile: AIUpdatePayload.ProfilePatch(
        sex: nil, age: 5, heightCM: 100, activityLevel: 1.6, trainingDaysPerWeek: 0)),
        data: emptyBase),
    Case(name: "profile_全部超上限", payload: payload(profile: AIUpdatePayload.ProfilePatch(
        sex: nil, age: 200, heightCM: 300, activityLevel: nil, trainingDaysPerWeek: 9)),
        data: emptyBase),

    // 身高一位小数 + 0.05 阈值
    Case(name: "身高_舍入到一位", payload: payload(profile: AIUpdatePayload.ProfilePatch(
        sex: nil, age: nil, heightCM: 175.46, activityLevel: nil, trainingDaysPerWeek: nil)),
        data: emptyBase),
    Case(name: "身高_阈值内不报变更", payload: payload(profile: AIUpdatePayload.ProfilePatch(
        sex: nil, age: nil, heightCM: 175.04, activityLevel: nil, trainingDaysPerWeek: nil)),
        data: emptyBase),
    Case(name: "身高_阈值外报变更", payload: payload(profile: AIUpdatePayload.ProfilePatch(
        sex: nil, age: nil, heightCM: 175.06, activityLevel: nil, trainingDaysPerWeek: nil)),
        data: emptyBase),

    // 活动系数吸附
    Case(name: "活动系数_吸附1.55", payload: payload(profile: AIUpdatePayload.ProfilePatch(
        sex: nil, age: nil, heightCM: nil, activityLevel: 1.6, trainingDaysPerWeek: nil)),
        data: emptyBase),
    Case(name: "活动系数_吸附1.375", payload: payload(profile: AIUpdatePayload.ProfilePatch(
        sex: nil, age: nil, heightCM: nil, activityLevel: 1.4, trainingDaysPerWeek: nil)),
        data: emptyBase),
    Case(name: "活动系数_同值不报", payload: payload(profile: AIUpdatePayload.ProfilePatch(
        sex: nil, age: nil, heightCM: nil, activityLevel: 1.5504, trainingDaysPerWeek: nil)),
        data: emptyBase),

    // 性别归一
    Case(name: "性别_M", payload: payload(profile: AIUpdatePayload.ProfilePatch(
        sex: "M", age: nil, heightCM: nil, activityLevel: nil, trainingDaysPerWeek: nil)),
        data: emptyBase),
    Case(name: "性别_男", payload: payload(profile: AIUpdatePayload.ProfilePatch(
        sex: " 男 ", age: nil, heightCM: nil, activityLevel: nil, trainingDaysPerWeek: nil)),
        data: emptyBase),
    Case(name: "性别_Female", payload: payload(profile: AIUpdatePayload.ProfilePatch(
        sex: "Female", age: nil, heightCM: nil, activityLevel: nil, trainingDaysPerWeek: nil)),
        data: emptyBase),
    Case(name: "性别_女", payload: payload(profile: AIUpdatePayload.ProfilePatch(
        sex: "女", age: nil, heightCM: nil, activityLevel: nil, trainingDaysPerWeek: nil)),
        data: emptyBase),
    Case(name: "性别_认不出", payload: payload(profile: AIUpdatePayload.ProfilePatch(
        sex: "x", age: nil, heightCM: nil, activityLevel: nil, trainingDaysPerWeek: nil)),
        data: emptyBase),
    Case(name: "性别_同为男不报", payload: payload(profile: AIUpdatePayload.ProfilePatch(
        sex: "male", age: nil, heightCM: nil, activityLevel: nil, trainingDaysPerWeek: nil)),
        data: emptyBase),

    // 目标类型归一
    Case(name: "目标_增肌", payload: payload(goal: AIUpdatePayload.GoalPatch(
        type: "增肌", targetWeightKG: nil, targetBodyFatPct: nil, weeklyTargetDeltaKG: nil)),
        data: filledBase),
    Case(name: "目标_减重", payload: payload(goal: AIUpdatePayload.GoalPatch(
        type: "减重", targetWeightKG: nil, targetBodyFatPct: nil, weeklyTargetDeltaKG: nil)),
        data: emptyBase),
    Case(name: "目标_MAINTAIN", payload: payload(goal: AIUpdatePayload.GoalPatch(
        type: "MAINTAIN", targetWeightKG: nil, targetBodyFatPct: nil, weeklyTargetDeltaKG: nil)),
        data: emptyBase),
    Case(name: "目标_认不出", payload: payload(goal: AIUpdatePayload.GoalPatch(
        type: "zzz", targetWeightKG: nil, targetBodyFatPct: nil, weeklyTargetDeltaKG: nil)),
        data: emptyBase),

    // 目标体重
    Case(name: "目标体重_下限", payload: payload(goal: AIUpdatePayload.GoalPatch(
        type: nil, targetWeightKG: 25, targetBodyFatPct: nil, weeklyTargetDeltaKG: nil)),
        data: emptyBase),
    Case(name: "目标体重_上限", payload: payload(goal: AIUpdatePayload.GoalPatch(
        type: nil, targetWeightKG: 250, targetBodyFatPct: nil, weeklyTargetDeltaKG: nil)),
        data: emptyBase),
    Case(name: "目标体重_阈值内", payload: payload(goal: AIUpdatePayload.GoalPatch(
        type: nil, targetWeightKG: 75.04, targetBodyFatPct: nil, weeklyTargetDeltaKG: nil)),
        data: emptyBase),
    Case(name: "目标体重_阈值外", payload: payload(goal: AIUpdatePayload.GoalPatch(
        type: nil, targetWeightKG: 75.06, targetBodyFatPct: nil, weeklyTargetDeltaKG: nil)),
        data: emptyBase),

    // 目标体脂：从「未设置」到有值
    Case(name: "目标体脂_从未设置", payload: payload(goal: AIUpdatePayload.GoalPatch(
        type: nil, targetWeightKG: nil, targetBodyFatPct: 15, weeklyTargetDeltaKG: nil)),
        data: emptyBase),
    Case(name: "目标体脂_越界", payload: payload(goal: AIUpdatePayload.GoalPatch(
        type: nil, targetWeightKG: nil, targetBodyFatPct: 99, weeklyTargetDeltaKG: nil)),
        data: emptyBase),
    Case(name: "目标体脂_阈值内", payload: payload(goal: AIUpdatePayload.GoalPatch(
        type: nil, targetWeightKG: nil, targetBodyFatPct: 20.04, weeklyTargetDeltaKG: nil)),
        data: filledBase),
    Case(name: "目标体脂_阈值外", payload: payload(goal: AIUpdatePayload.GoalPatch(
        type: nil, targetWeightKG: nil, targetBodyFatPct: 20.06, weeklyTargetDeltaKG: nil)),
        data: filledBase),

    // 每周增减：两位小数 + 0.005 阈值
    Case(name: "每周增减_负数夹到0", payload: payload(goal: AIUpdatePayload.GoalPatch(
        type: nil, targetWeightKG: nil, targetBodyFatPct: nil, weeklyTargetDeltaKG: -1)),
        data: emptyBase),
    Case(name: "每周增减_超1夹到1", payload: payload(goal: AIUpdatePayload.GoalPatch(
        type: nil, targetWeightKG: nil, targetBodyFatPct: nil, weeklyTargetDeltaKG: 5)),
        data: emptyBase),
    Case(name: "每周增减_舍入0.255", payload: payload(goal: AIUpdatePayload.GoalPatch(
        type: nil, targetWeightKG: nil, targetBodyFatPct: nil, weeklyTargetDeltaKG: 0.255)),
        data: emptyBase),
    Case(name: "每周增减_舍入0.2551", payload: payload(goal: AIUpdatePayload.GoalPatch(
        type: nil, targetWeightKG: nil, targetBodyFatPct: nil, weeklyTargetDeltaKG: 0.2551)),
        data: emptyBase),
    Case(name: "每周增减_0.251舍到0.25", payload: payload(goal: AIUpdatePayload.GoalPatch(
        type: nil, targetWeightKG: nil, targetBodyFatPct: nil, weeklyTargetDeltaKG: 0.251)),
        data: emptyBase),

    // 三大项：夹紧 + 四舍五入到 2.5kg
    Case(name: "三大项_下限夹紧", payload: payload(bigThree: AIUpdatePayload.BigThreePatch(
        benchKG: 10, squatKG: nil, deadliftKG: nil)), data: emptyBase),
    Case(name: "三大项_上限夹紧", payload: payload(bigThree: AIUpdatePayload.BigThreePatch(
        benchKG: 500, squatKG: nil, deadliftKG: nil)), data: emptyBase),
    Case(name: "三大项_舍入到2.5", payload: payload(bigThree: AIUpdatePayload.BigThreePatch(
        benchKG: 102, squatKG: nil, deadliftKG: nil)), data: emptyBase),
    Case(name: "三大项_舍入到103.75", payload: payload(bigThree: AIUpdatePayload.BigThreePatch(
        benchKG: 103.75, squatKG: nil, deadliftKG: nil)), data: emptyBase),
    Case(name: "三大项_同值不报", payload: payload(bigThree: AIUpdatePayload.BigThreePatch(
        benchKG: 100.004, squatKG: nil, deadliftKG: nil)), data: filledBase),
    Case(name: "三大项_只改一项", payload: payload(bigThree: AIUpdatePayload.BigThreePatch(
        benchKG: nil, squatKG: 145, deadliftKG: nil)), data: filledBase),

    // 备注
    Case(name: "备注_单条", payload: payload(notes: ["晚上训练，睡眠 7 小时"]), data: emptyBase),
    Case(name: "备注_重复不重加", payload: payload(notes: ["膝盖有旧伤，深蹲不要上太大重量"]),
         data: filledBase),
    Case(name: "备注_空串与空白", payload: payload(notes: ["", "   ", "\n\t"]), data: emptyBase),
    Case(name: "备注_首尾空白裁掉", payload: payload(notes: ["  早睡  "]), data: emptyBase),
    Case(name: "备注_超长截断200", payload: payload(notes: [longNote]), data: emptyBase),
    Case(name: "备注_超过12条", payload: payload(notes: (1...20).map { "偏好\($0)" }),
         data: emptyBase),
    Case(name: "备注_已有11条再加3条", payload: payload(notes: ["新A", "新B", "新C"]),
         data: baseData(bigThree: nil, bodyFat: nil, notes: (1...11).map { "旧\($0)" })),
]

// MARK: - 收集


var out: [String: Any] = [:]
for c in cases {
    let r = AppStore.plannedChanges(c.payload, in: c.data)
    var entry: [String: Any] = ["changes": r.changes]

    // 把改后的关键字段原样带出来，便于网页版比对「改成了什么」而不只是「报了什么」
    var d: [String: Any] = [:]
    d["profile"] = [
        "sex": r.updated.profile.sex,
        "age": r.updated.profile.age,
        "heightCM": r.updated.profile.heightCM,
        "activityLevel": r.updated.profile.activityLevel,
        "trainingDaysPerWeek": r.updated.profile.trainingDaysPerWeek,
    ] as [String: Any]
    var g: [String: Any] = [
        "type": r.updated.goal.type.rawValue,
        "targetWeightKG": r.updated.goal.targetWeightKG,
        "weeklyTargetDeltaKG": r.updated.goal.weeklyTargetDeltaKG,
    ]
    if let bf = r.updated.goal.targetBodyFatPct { g["targetBodyFatPct"] = bf }
    d["goal"] = g
    if let b = r.updated.bigThree {
        var m: [String: Any] = [:]
        if let v = b.benchKG { m["benchKG"] = v }
        if let v = b.squatKG { m["squatKG"] = v }
        if let v = b.deadliftKG { m["deadliftKG"] = v }
        d["bigThree"] = m
    }
    d["coachNotes"] = r.updated.coachNotes ?? []
    entry["updated"] = d
    out[c.name] = entry
}

let data = try! JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(data)
