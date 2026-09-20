// 用 Mac 版（Swift）当 oracle，吐出一份期望值 fixture，供网页版的 vitest 逐值比对。
// 跑 `npm run oracle` 重新生成。
//
// 只依赖 Models / Engine / RemindersSync，不碰 AppStore（那个要读写真实用户数据文件）。

import Foundation

// MARK: - 固定场景

func makeProfile() -> UserProfile {
    UserProfile(sex: "male", age: 25, heightCM: 175, activityLevel: 1.55, trainingDaysPerWeek: 4)
}

func makeGoal() -> Goal {
    Goal(type: .bulk, targetWeightKG: 75, targetBodyFatPct: nil, weeklyTargetDeltaKG: 0.25)
}

// 训练历史一律相对「当前时刻」构造，这样 30 天窗口在 fixture 里永远对齐，
// 测试放多久以后跑都稳定。偏移量本身也会写进 fixture，供 TS 侧重建同样的数据。
let realNow = Date()

func daysAgo(_ n: Int) -> Date {
    Calendar.current.date(byAdding: .day, value: -n, to: realNow)!
}

/// 固定时刻，只给 .ics 用（DTSTART 是 yyyyMMdd 本地日期）。
/// 取 UTC 正午：任何时区下都落在同一天，fixture 不会因时区漂移。
let fixedNow = ISO8601DateFormatter().date(from: "2026-09-20T12:00:00Z")!

/// [天数偏移, 拆分, [(动作, [(重量, 次数)])]]
let workoutSpec: [(Int, String, [(String, [(Double, Int)])])] = [
    (3, "推", [
        ("杠铃卧推", [(80, 8), (80, 8)]),
        ("站姿推举", [(40, 8)]),
        ("绳索下压", [(25, 12)]),
    ]),
    (10, "腿", [
        ("杠铃深蹲", [(110, 8)]),
        ("罗马尼亚硬拉", [(90, 10)]),
    ]),
    // 45 天前 —— 落在 30 天窗口外，只有窗口内没有记录时才该被用到
    (45, "拉", [
        ("硬拉", [(150, 5)]),
        ("高位下拉", [(55, 10)]),
    ]),
    // 一年前的旧 PR，不该顶掉近期配重
    (365, "推", [
        ("杠铃卧推", [(120, 3)]),
    ]),
]

/// 历史训练：近 30 天内 3 条 + 一条窗口外的 + 一条一年前的旧 PR
func makeWorkouts() -> [WorkoutSession] {
    workoutSpec.map { (offset, split, exercises) in
        WorkoutSession(date: daysAgo(offset), splitName: split, exercises: exercises.map { (name, sets) in
            ExerciseEntry(name: name, sets: sets.map { SetEntry(reps: $0.1, weightKG: $0.0) })
        }, durationMin: 60)
    }
}

var emptyData = AppData(profile: makeProfile(), goal: makeGoal())
emptyData.exercises = SeedData.exercises
emptyData.foods = SeedData.foods

var manualData = emptyData
manualData.bigThree = BigThreeMax(benchKG: 100, squatKG: 140, deadliftKG: 180)

var historyData = emptyData
historyData.workouts = makeWorkouts()

var bothData = historyData
bothData.bigThree = BigThreeMax(benchKG: 100, squatKG: 140, deadliftKG: 180)

let scenarios: [(String, AppData)] = [
    ("emptyData", emptyData),
    ("manualAnchors", manualData),
    ("historyOnly", historyData),
    ("both", bothData),
]

let allExercises = SeedData.exercises.map { $0.name }
let repList = [3, 5, 6, 8, 10, 12, 15, 20]
let bodyWeight = 75.0

// MARK: - 收集

var out: [String: Any] = [:]

// 1) 配重
var prescribed: [String: Any] = [:]
for (label, data) in scenarios {
    var byExercise: [String: Any] = [:]
    for name in allExercises {
        var byReps: [String: Any] = [:]
        for reps in repList {
            byReps["\(reps)"] = StrengthModel.prescribedWeight(
                for: name, reps: reps, data: data, bodyWeightKG: bodyWeight)
        }
        byExercise[name] = byReps
    }
    prescribed[label] = byExercise
}
out["prescribed"] = prescribed

// 2) 基础公式
var oneRep: [String: Any] = [:]
for w in [0.0, 40.0, 60.0, 80.0, 100.0, 132.5] {
    for r in [0, 1, 3, 5, 8, 12, 20] {
        oneRep["\(w)_\(r)"] = StrengthModel.oneRepMax(weight: w, reps: r)
    }
}
out["oneRepMax"] = oneRep

var intensity: [String: Any] = [:]
for r in [0, 1, 3, 5, 6, 8, 10, 12, 15, 20] {
    intensity["\(r)"] = StrengthModel.intensity(forReps: r)
}
out["intensity"] = intensity

var plate: [String: Any] = [:]
for x in [0.0, 1.2, 1.25, 2.4, 2.5, 3.74, 3.75, 5.0, 62.3, 62.5, 63.7, 100.0] {
    plate["\(x)"] = StrengthModel.roundToPlate(x)
}
out["roundToPlate"] = plate

// 3) 默认起始重量
var defaults: [String: Any] = [:]
for name in allExercises { defaults[name] = CalorieEstimator.defaultWeight(for: name, bodyWeightKG: bodyWeight) }
out["defaultWeight"] = defaults

// 4) 锚点
func encodeBigThree(_ m: BigThreeMax) -> [String: Any] {
    var d: [String: Any] = [:]
    if let v = m.benchKG { d["bench"] = v }
    if let v = m.squatKG { d["squat"] = v }
    if let v = m.deadliftKG { d["deadlift"] = v }
    return d
}
out["anchors"] = [
    "emptyData": encodeBigThree(StrengthModel.anchors(data: emptyData)),
    "manualAnchors": encodeBigThree(StrengthModel.anchors(data: manualData)),
    "historyOnly": encodeBigThree(StrengthModel.anchors(data: historyData)),
    "both": encodeBigThree(StrengthModel.anchors(data: bothData)),
    "historicalFromHistory": encodeBigThree(StrengthModel.historicalAnchors(workouts: historyData.workouts)),
]

var anchor1RM: [String: Any] = [:]
for name in allExercises {
    anchor1RM[name] = StrengthModel.anchor1RM(for: name, data: manualData) ?? -1
}
out["anchor1RM_manualAnchors"] = anchor1RM

// 5) 1RM 历史查询
var best: [String: Any] = [:]
var presc: [String: Any] = [:]
for name in allExercises {
    best[name] = StrengthModel.best1RM(exercise: name, workouts: historyData.workouts)
    // 不传 now，走 App 实际使用的默认值（Date()），保证与 TS 侧同一口径
    presc[name] = StrengthModel.prescription1RM(exercise: name, workouts: historyData.workouts)
}
out["best1RM"] = best
out["prescription1RM_30d"] = presc

// 6) 卡路里：一张固定计划，在多组身高下的逐动作与合计
let calWorkout = PlannedWorkout(date: realNow, splitName: "推", exercises: [
    PlannedExercise(name: "杠铃卧推", targetSets: 4, targetReps: 8, targetWeightKG: 67.5),
    PlannedExercise(name: "引体向上", targetSets: 3, targetReps: 8, targetWeightKG: 0),
    PlannedExercise(name: "哑铃侧平举", targetSets: 3, targetReps: 15, targetWeightKG: 10),
    PlannedExercise(name: "杠铃深蹲", targetSets: 5, targetReps: 5, targetWeightKG: 100),
    PlannedExercise(name: "站姿提踵", targetSets: 4, targetReps: 15, targetWeightKG: 80),
])
var caloriesByHeight: [String: Any] = [:]
for h in [0.0, 140.0, 150.0, 160.0, 170.0, 175.0, 182.5, 190.0, 195.0, 210.0] {
    var per: [String: Any] = [:]
    for ex in calWorkout.exercises {
        per[ex.name] = CalorieEstimator.calories(for: ex, bodyWeightKG: 70, heightCM: h)
    }
    var factors: [String: Any] = [:]
    for ex in calWorkout.exercises {
        factors[ex.name] = CalorieEstimator.heightFactor(for: ex.name, heightCM: h)
    }
    caloriesByHeight["\(h)"] = [
        "base": CalorieEstimator.baseTotal(workout: calWorkout, bodyWeightKG: 70),
        "total": CalorieEstimator.total(workout: calWorkout, bodyWeightKG: 70, heightCM: h),
        "perExercise": per,
        "factors": factors,
    ] as [String: Any]
}
out["calories"] = caloriesByHeight

// 7) 饮食
var diet: [String: Any] = [:]
for goalType in [GoalType.bulk, .cut, .maintain] {
    for w in [55.0, 70.0, 75.0, 90.0] {
        var g = makeGoal(); g.type = goalType
        let m = DietPlanner.targets(profile: makeProfile(), goal: g, weightKG: w)
        diet["\(goalType.rawValue)_\(w)"] = ["kcal": m.kcal, "protein": m.protein, "carb": m.carb, "fat": m.fat]
    }
}
out["diet"] = diet

var meals: [String: Any] = [:]
for goalType in [GoalType.bulk, .cut, .maintain] {
    var g = makeGoal(); g.type = goalType
    meals[goalType.rawValue] = DietPlanner.sampleMealPlan(
        profile: makeProfile(), goal: g, weightKG: 75, foods: SeedData.foods)
}
meals["emptyLibrary"] = DietPlanner.sampleMealPlan(
    profile: makeProfile(), goal: makeGoal(), weightKG: 75, foods: [])
out["mealPlan"] = meals

// 8) 拆分模板与生成计划
var splits: [String: Any] = [:]
for d in 1...7 {
    splits["\(d)"] = TrainingPlanner.splits(for: d).map { t in
        ["name": t.name, "items": t.items.map { ["name": $0.name, "sets": $0.sets, "reps": $0.reps] }]
    }
}
out["splits"] = splits

// 用固定的已知日期构造「星期几 → 计划」，日期落在固定的一周内
var generated: [String: Any] = [:]
let weekStart = fixedNow // 2026-09-20，周日
for days in 1...7 {
    var d = bothData
    d.profile.trainingDaysPerWeek = days
    for offset in 0..<7 {
        let date = Calendar.current.date(byAdding: .day, value: offset, to: weekStart)!
        let plan = TrainingPlanner.generatePlan(date: date, data: d)
        let key = "\(days)_\(offset)"
        generated[key] = [
            "splitName": plan.splitName,
            "exercises": plan.exercises.map {
                ["name": $0.name, "targetSets": $0.targetSets,
                 "targetReps": $0.targetReps, "targetWeightKG": $0.targetWeightKG]
            },
        ]
    }
}
out["generatedPlan"] = generated

// 9) 提醒/ICS 文案
var texts: [String: Any] = [:]
for h in [160.0, 175.0, 182.5] {
    texts["\(h)"] = WorkoutText.note(for: calWorkout, bodyWeightKG: 70, heightCM: h)
}
out["workoutText"] = texts

let icsWorkout = PlannedWorkout(
    id: UUID(uuidString: "11111111-2222-3333-4444-555555555555")!,
    date: fixedNow, splitName: "推",
    exercises: calWorkout.exercises)
out["ics"] = ICSExporter.ics(for: [icsWorkout], bodyWeightKG: 70, heightCM: 182.5)

// MARK: - 输出

// 供 TS 侧重建设定数据的训练历史（相对天数偏移，不含绝对日期）
out["workoutSpec"] = workoutSpec.map { (offset, split, exercises) in
    [
        "daysAgo": offset,
        "split": split,
        "exercises": exercises.map { (name, sets) in
            ["name": name, "sets": sets.map { ["weightKG": $0.0, "reps": $0.1] }]
        },
    ] as [String: Any]
}
// generatePlan 用的「星期几」日期：固定日历日，只用来决定选哪套模板
out["planDates"] = (0..<7).map { offset in
    ISO8601DateFormatter().string(
        from: Calendar.current.date(byAdding: .day, value: offset, to: weekStart)!)
}

out["_meta"] = [
    "timeZone": TimeZone.current.identifier,
    "note": "由 Mac 版 Swift 代码生成，网页版算法必须逐值对齐",
]
let data = try! JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(data)
