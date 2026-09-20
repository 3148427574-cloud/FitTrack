import Foundation

// MARK: - 能量消耗（TDEE）

enum TDEE {
    /// Mifflin-St Jeor 基础代谢
    static func bmr(profile: UserProfile, weightKG: Double) -> Double {
        let base = 10 * weightKG + 6.25 * profile.heightCM - 5 * Double(profile.age)
        return profile.sex.lowercased().hasPrefix("f") ? base - 161 : base + 5
    }

    static func tdee(profile: UserProfile, weightKG: Double) -> Double {
        bmr(profile: profile, weightKG: weightKG) * profile.activityLevel
    }
}

// MARK: - 饮食计划

struct Macros: Equatable {
    var kcal: Double
    var protein: Double
    var carb: Double
    var fat: Double
}

enum DietPlanner {
    /// 根据目标计算每日热量与三大营养素（单位：克，热量：千卡）
    static func targets(profile: UserProfile, goal: Goal, weightKG: Double) -> Macros {
        let tdee = TDEE.tdee(profile: profile, weightKG: weightKG)
        let kcal: Double
        switch goal.type {
        case .bulk: kcal = tdee + 400
        case .cut: kcal = tdee - 400
        case .maintain: kcal = tdee
        }
        let protein = (goal.type == .maintain ? 1.6 : 2.0) * weightKG
        let fat = 0.9 * weightKG
        let carbKcal = max(0, kcal - protein * 4 - fat * 9)
        return Macros(kcal: kcal, protein: protein, carb: carbKcal / 4, fat: fat)
    }

    /// 从食物库按目标克数简单搭配餐单（按 4 餐分配）
    static func sampleMealPlan(profile: UserProfile, goal: Goal, weightKG: Double, foods: [Food]) -> [String] {
        let m = targets(profile: profile, goal: goal, weightKG: weightKG)
        let proteinFoods = foods.filter { $0.proteinPer100g > 15 }.sorted { $0.proteinPer100g > $1.proteinPer100g }
        let carbFoods = foods.filter { $0.carbPer100g > 15 }.sorted { $0.carbPer100g > $1.carbPer100g }
        let fatFoods = foods.filter { $0.fatPer100g > 15 }.sorted { $0.fatPer100g > $1.fatPer100g }
        guard let p = proteinFoods.first, let c = carbFoods.first, let f = fatFoods.first else {
            return ["食物库为空，请先导入或补充食物"]
        }
        let proteinGramsPerMeal = m.protein / 4
        let carbGramsPerMeal = m.carb / 4
        let fatGramsPerMeal = m.fat / 4
        let pAmount = proteinGramsPerMeal / (p.proteinPer100g / 100)
        let cAmount = carbGramsPerMeal / (c.carbPer100g / 100)
        let fAmount = fatGramsPerMeal / (f.fatPer100g / 100)
        var lines: [String] = []
        lines.append(String(format: "目标：%.0f 千卡 / 蛋白质 %.0fg / 碳水 %.0fg / 脂肪 %.0fg",
                            m.kcal, m.protein, m.carb, m.fat))
        for i in 1...4 {
            lines.append(String(format: "第%d餐：%@ %.0fg + %@ %.0fg + %@ %.0fg",
                                i, p.name, pAmount, c.name, cAmount, f.name, fAmount))
        }
        return lines
    }
}

// MARK: - 卡路里消耗估算

enum CalorieEstimator {
    static let bodyweightExercises: Set<String> = ["引体向上"]
    static let compoundExercises: Set<String> = [
        "杠铃卧推", "上斜哑铃卧推", "站姿推举", "杠铃划船", "坐姿划船", "高位下拉",
        "杠铃深蹲", "罗马尼亚硬拉", "硬拉", "腿举", "保加利亚分腿蹲", "臀桥",
    ]

    static func isBodyweight(_ name: String) -> Bool { bodyweightExercises.contains(name) }

    /// 力量训练代谢当量（1 MET = 1 千卡/公斤/小时）
    static func met(for name: String) -> Double {
        if isBodyweight(name) { return 5.0 }
        if compoundExercises.contains(name) { return 6.0 }
        return 4.5
    }

    // MARK: 身高（行程）修正

    /// MET 表按成年人平均身高标定，身高校正以此为原点
    static let referenceHeightCM: Double = 175

    /// 行程敏感度：身高每偏离基准 1%，该动作能耗近似同向变化 s%。
    /// 深蹲/硬拉位移接近整条腿长，提踵/臂屈伸位移只由小关节决定。
    static let romSensitivityByExercise: [String: Double] = [
        "杠铃深蹲": 0.8, "硬拉": 0.8, "罗马尼亚硬拉": 0.8, "保加利亚分腿蹲": 0.8, "腿举": 0.7,
        "站姿推举": 0.6, "引体向上": 0.6, "高位下拉": 0.6, "杠铃划船": 0.6, "坐姿划船": 0.5,
        "杠铃卧推": 0.5, "上斜哑铃卧推": 0.5,
        "臀桥": 0.4, "腿屈伸": 0.3, "腿弯举": 0.3,
        "哑铃侧平举": 0.3, "面拉": 0.3, "哑铃弯举": 0.3, "锤式弯举": 0.3,
        "绳索下压": 0.2, "仰卧臂屈伸": 0.2,
        "站姿提踵": 0.15, "坐姿提踵": 0.15,
    ]

    static func romSensitivity(for name: String) -> Double { romSensitivityByExercise[name] ?? 0.4 }

    /// 身高的行程修正系数，夹紧到 ±8%，避免极端身高给出离谱估算。
    /// 这是启发式模型：总能耗里随行程变化的只有克服重力做功那一部分，
    /// 等长收缩、心肺与恢复成本与肢体长度无关，所以修正量必须温和。
    static func heightFactor(for name: String, heightCM: Double) -> Double {
        guard heightCM > 0 else { return 1 }
        let raw = 1 + romSensitivity(for: name) * (heightCM / referenceHeightCM - 1)
        return min(max(raw, 0.92), 1.08)
    }

    /// 未经身高校正的基础估算：MET × 体重(kg) × 时长(小时)，每组约 1.5 分钟（含组间休息）
    static func baseCalories(for ex: PlannedExercise, bodyWeightKG: Double) -> Double {
        met(for: ex.name) * bodyWeightKG * Double(ex.targetSets) * 1.5 / 60.0
    }

    /// 单动作估算消耗（千卡）= 基础估算 × 身高的行程修正
    static func calories(for ex: PlannedExercise, bodyWeightKG: Double, heightCM: Double) -> Double {
        baseCalories(for: ex, bodyWeightKG: bodyWeightKG) * heightFactor(for: ex.name, heightCM: heightCM)
    }

    static func baseTotal(workout: PlannedWorkout, bodyWeightKG: Double) -> Double {
        workout.exercises.reduce(0) { $0 + baseCalories(for: $1, bodyWeightKG: bodyWeightKG) }
    }

    static func total(workout: PlannedWorkout, bodyWeightKG: Double, heightCM: Double) -> Double {
        workout.exercises.reduce(0) {
            $0 + calories(for: $1, bodyWeightKG: bodyWeightKG, heightCM: heightCM)
        }
    }

    /// 无历史 1RM 时的保守起始重量（自重动作返回 0）
    static func defaultWeight(for name: String, bodyWeightKG: Double) -> Double {
        if isBodyweight(name) { return 0 }
        let ratios: [String: Double] = [
            "杠铃深蹲": 0.5, "硬拉": 0.6, "杠铃卧推": 0.4, "站姿推举": 0.25,
            "杠铃划船": 0.35, "罗马尼亚硬拉": 0.5, "腿举": 0.6,
            "上斜哑铃卧推": 0.15, "坐姿划船": 0.25, "高位下拉": 0.3,
            "保加利亚分腿蹲": 0.1, "臀桥": 0.3,
        ]
        let w = (ratios[name] ?? 0.2) * bodyWeightKG
        return (w / 2.5).rounded() * 2.5
    }
}

// MARK: - 力量基准（三大项 + 历史 1RM）

enum BigThreeLift: String, CaseIterable {
    case bench, squat, deadlift

    var label: String {
        switch self {
        case .bench: return "卧推"
        case .squat: return "深蹲"
        case .deadlift: return "硬拉"
        }
    }

    /// 训练记录里对应的主项动作名
    var exerciseNames: [String] {
        switch self {
        case .bench: return ["杠铃卧推"]
        case .squat: return ["杠铃深蹲"]
        case .deadlift: return ["硬拉"]
        }
    }

    func value(in m: BigThreeMax) -> Double? {
        switch self {
        case .bench: return m.benchKG
        case .squat: return m.squatKG
        case .deadlift: return m.deadliftKG
        }
    }

    func set(_ v: Double?, in m: inout BigThreeMax) {
        switch self {
        case .bench: m.benchKG = v
        case .squat: m.squatKG = v
        case .deadlift: m.deadliftKG = v
        }
    }
}

/// 由训练历史与三大项极限推导训练配重。
enum StrengthModel {
    /// Epley 公式估算 1RM
    static func oneRepMax(weight: Double, reps: Int) -> Double {
        guard reps > 0, weight > 0 else { return 0 }
        return weight * (1 + Double(reps) / 30.0)
    }

    /// 目标次数的训练强度（%1RM），与 oneRepMax 互为逆运算
    static func intensity(forReps reps: Int) -> Double {
        guard reps > 0 else { return 0.75 }
        return 1.0 / (1.0 + Double(reps) / 30.0)
    }

    static func roundToPlate(_ kg: Double) -> Double { (kg / 2.5).rounded() * 2.5 }

    /// 某动作历史最好 1RM
    static func best1RM(exercise: String, workouts: [WorkoutSession]) -> Double {
        workouts.flatMap { $0.exercises.filter { $0.name == exercise } }
            .flatMap { $0.sets }
            .map { oneRepMax(weight: $0.weightKG, reps: $0.reps) }
            .max() ?? 0
    }

    /// 做渐进超负荷基准的 1RM：优先最近 30 天，没有近期记录再退回历史最好，
    /// 避免一年前的 PR 把今天的配重顶得过高。
    static func prescription1RM(exercise: String, workouts: [WorkoutSession],
                                withinDays days: Int = 30, now: Date = Date()) -> Double {
        let cutoff = Calendar.current.date(byAdding: .day, value: -days, to: now) ?? .distantPast
        let recent = best1RM(exercise: exercise, workouts: workouts.filter { $0.date >= cutoff })
        return recent > 0 ? recent : best1RM(exercise: exercise, workouts: workouts)
    }

    /// 从训练历史估算三大项极限
    static func historicalAnchors(workouts: [WorkoutSession]) -> BigThreeMax {
        var m = BigThreeMax()
        for lift in BigThreeLift.allCases {
            let v = lift.exerciseNames.map { best1RM(exercise: $0, workouts: workouts) }.max() ?? 0
            lift.set(v > 0 ? roundToPlate(v) : nil, in: &m)
        }
        return m
    }

    /// 生效锚点：手填优先，缺项用历史补齐
    static func anchors(data: AppData) -> BigThreeMax {
        let manual = data.bigThree ?? BigThreeMax()
        let hist = historicalAnchors(workouts: data.workouts)
        var m = BigThreeMax()
        for lift in BigThreeLift.allCases {
            lift.set(lift.value(in: manual) ?? lift.value(in: hist), in: &m)
        }
        return m
    }

    /// 辅项 1RM 相对三大项的倍数。器械类个体差异极大（腿举能差 2 倍），取偏保守值。
    /// 哑铃类为单只重量。
    static let anchorRatios: [String: (lift: BigThreeLift, ratio: Double)] = [
        // 三大项本身：手填/历史锚点直接就是它们的 1RM
        "杠铃卧推": (.bench, 1.0),
        "杠铃深蹲": (.squat, 1.0),
        "硬拉": (.deadlift, 1.0),
        "站姿推举": (.bench, 0.62),
        "上斜哑铃卧推": (.bench, 0.35),
        "杠铃划船": (.bench, 0.85),
        "坐姿划船": (.bench, 0.85),
        "高位下拉": (.bench, 0.95),
        "面拉": (.bench, 0.40),
        "哑铃侧平举": (.bench, 0.12),
        "哑铃弯举": (.bench, 0.22),
        "锤式弯举": (.bench, 0.24),
        "绳索下压": (.bench, 0.45),
        "仰卧臂屈伸": (.bench, 0.18),
        "罗马尼亚硬拉": (.deadlift, 0.80),
        "腿举": (.squat, 2.5),
        "保加利亚分腿蹲": (.squat, 0.20),
        "臀桥": (.squat, 1.30),
        "腿屈伸": (.squat, 0.55),
        "腿弯举": (.squat, 0.45),
        "站姿提踵": (.squat, 1.40),
        "坐姿提踵": (.squat, 1.20),
    ]

    /// 由三大项锚点推导某动作的 1RM；没有对应锚点或系数时返回 nil
    static func anchor1RM(for exercise: String, data: AppData) -> Double? {
        guard let entry = anchorRatios[exercise],
              let base = entry.lift.value(in: anchors(data: data)), base > 0 else { return nil }
        return base * entry.ratio
    }

    /// 配重优先级：本动作近期 1RM → 三大项锚点推导 → 体重比例兜底
    static func prescribedWeight(for exercise: String, reps: Int,
                                 data: AppData, bodyWeightKG: Double) -> Double {
        if CalorieEstimator.isBodyweight(exercise) { return 0 }
        let intensity = self.intensity(forReps: reps)
        let direct = prescription1RM(exercise: exercise, workouts: data.workouts)
        if direct > 0 { return roundToPlate(direct * intensity) }
        if let anchor = anchor1RM(for: exercise, data: data) {
            return roundToPlate(anchor * intensity)
        }
        return CalorieEstimator.defaultWeight(for: exercise, bodyWeightKG: bodyWeightKG)
    }
}

// MARK: - 训练计划生成 + 渐进超负荷

struct SplitTemplate {
    let name: String
    let items: [(name: String, sets: Int, reps: Int)]
}

enum TrainingPlanner {

    /// 根据每周训练天数选择拆分模板
    static func splits(for days: Int) -> [SplitTemplate] {
        let push = SplitTemplate(name: "推", items: [
            ("杠铃卧推", 4, 8), ("上斜哑铃卧推", 3, 10), ("站姿推举", 3, 8),
            ("哑铃侧平举", 3, 15), ("绳索下压", 3, 12), ("仰卧臂屈伸", 3, 12),
        ])
        let pull = SplitTemplate(name: "拉", items: [
            ("硬拉", 4, 6), ("引体向上", 3, 8), ("杠铃划船", 3, 10),
            ("面拉", 3, 15), ("哑铃弯举", 3, 12), ("锤式弯举", 3, 12),
        ])
        let legs = SplitTemplate(name: "腿", items: [
            ("杠铃深蹲", 4, 8), ("罗马尼亚硬拉", 3, 10), ("腿举", 3, 12),
            ("腿弯举", 3, 12), ("站姿提踵", 4, 15),
        ])
        let upperA = SplitTemplate(name: "上肢A", items: [
            ("杠铃卧推", 4, 8), ("坐姿划船", 4, 10), ("站姿推举", 4, 8),
            ("引体向上", 3, 8), ("哑铃弯举", 3, 12), ("绳索下压", 3, 12),
        ])
        let lowerA = SplitTemplate(name: "下肢A", items: [
            ("杠铃深蹲", 4, 8), ("罗马尼亚硬拉", 4, 10), ("腿举", 4, 12),
            ("腿弯举", 3, 12), ("站姿提踵", 4, 15),
        ])
        let upperB = SplitTemplate(name: "上肢B", items: [
            ("上斜哑铃卧推", 4, 10), ("高位下拉", 4, 10), ("杠铃划船", 4, 8),
            ("哑铃侧平举", 3, 15), ("锤式弯举", 3, 12), ("仰卧臂屈伸", 3, 12),
        ])
        let lowerB = SplitTemplate(name: "下肢B", items: [
            ("硬拉", 4, 6), ("保加利亚分腿蹲", 3, 10), ("腿屈伸", 3, 12),
            ("臀桥", 3, 12), ("坐姿提踵", 4, 15),
        ])
        let full = SplitTemplate(name: "全身", items: [
            ("杠铃深蹲", 3, 8), ("杠铃卧推", 3, 8), ("杠铃划船", 3, 8),
            ("站姿推举", 3, 10), ("哑铃弯举", 2, 12), ("绳索下压", 2, 12),
        ])

        switch days {
        case ...2: return [full]
        case 3: return [push, pull, legs]
        case 4: return [upperA, lowerA, upperB, lowerB]
        case 5: return [push, pull, legs, upperA, lowerA]
        default: return [push, pull, legs, upperA, lowerA, full]
        }
    }

    /// 生成某天的训练计划：按目标次数对应的强度自动配重
    static func generatePlan(date: Date, data: AppData) -> PlannedWorkout {
        let templates = splits(for: data.profile.trainingDaysPerWeek)
        let weekday = Calendar.current.component(.weekday, from: date)
        let split = templates[(weekday - 1) % templates.count]
        let bodyWeight = data.bodyMetrics.sorted { $0.date < $1.date }.last?.weightKG ?? data.goal.targetWeightKG
        let exercises: [PlannedExercise] = split.items.map { item in
            let weight = StrengthModel.prescribedWeight(for: item.name, reps: item.reps,
                                                       data: data, bodyWeightKG: bodyWeight)
            return PlannedExercise(name: item.name, targetSets: item.sets,
                                   targetReps: item.reps, targetWeightKG: max(0, weight))
        }
        return PlannedWorkout(date: date, splitName: split.name, exercises: exercises)
    }
}
