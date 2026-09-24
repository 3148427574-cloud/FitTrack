import Foundation

// MARK: - 枚举

enum GoalType: String, Codable, CaseIterable, Identifiable {
    case bulk, cut, maintain
    var id: String { rawValue }
    var label: String {
        switch self {
        case .bulk: return "增肌"
        case .cut: return "减脂"
        case .maintain: return "维持"
        }
    }
}

enum WorkoutStatus: String, Codable {
    case planned, completed, skipped
    var label: String {
        switch self {
        case .planned: return "待完成"
        case .completed: return "已完成"
        case .skipped: return "已跳过"
        }
    }
}

/// 「生成今日计划」时可选的训练主题：前三个固定，第四个由用户输入名称
enum SplitFocus: String, CaseIterable, Identifiable {
    case chest = "胸"
    case back = "背"
    case legs = "腿"
    case custom = "自定义"

    var id: String { rawValue }
}

// MARK: - 训练相关

struct SetEntry: Codable, Hashable {
    var reps: Int
    var weightKG: Double
}

struct ExerciseEntry: Codable, Hashable, Identifiable {
    var id: UUID = UUID()
    var name: String
    var sets: [SetEntry]
    var rpe: Double?
}

struct WorkoutSession: Codable, Hashable, Identifiable {
    var id: UUID = UUID()
    var date: Date
    var splitName: String
    var exercises: [ExerciseEntry]
    var durationMin: Double
    var notes: String = ""

    private enum CodingKeys: String, CodingKey {
        case id, date, splitName, exercises, durationMin, notes
    }

    init(id: UUID = UUID(), date: Date, splitName: String, exercises: [ExerciseEntry],
         durationMin: Double, notes: String = "") {
        self.id = id
        self.date = date
        self.splitName = splitName
        self.exercises = exercises
        self.durationMin = durationMin
        self.notes = notes
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        date = try c.decode(Date.self, forKey: .date)
        splitName = try c.decode(String.self, forKey: .splitName)
        exercises = try c.decode([ExerciseEntry].self, forKey: .exercises)
        durationMin = try c.decode(Double.self, forKey: .durationMin)
        notes = try c.decodeIfPresent(String.self, forKey: .notes) ?? ""
    }
}

struct PlannedExercise: Codable, Hashable, Identifiable {
    var id: UUID = UUID()
    var name: String
    var targetSets: Int
    var targetReps: Int
    var targetWeightKG: Double
}

struct PlannedWorkout: Codable, Hashable, Identifiable {
    var id: UUID = UUID()
    var date: Date
    var splitName: String
    var exercises: [PlannedExercise]
    var status: WorkoutStatus = .planned
    var note: String?
    var reminderID: String?

    private enum CodingKeys: String, CodingKey {
        case id, date, splitName, exercises, status, note, reminderID
    }

    init(id: UUID = UUID(), date: Date, splitName: String, exercises: [PlannedExercise],
         status: WorkoutStatus = .planned, note: String? = nil, reminderID: String? = nil) {
        self.id = id
        self.date = date
        self.splitName = splitName
        self.exercises = exercises
        self.status = status
        self.note = note
        self.reminderID = reminderID
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        date = try c.decode(Date.self, forKey: .date)
        splitName = try c.decode(String.self, forKey: .splitName)
        exercises = try c.decode([PlannedExercise].self, forKey: .exercises)
        status = try c.decodeIfPresent(WorkoutStatus.self, forKey: .status) ?? .planned
        note = try c.decodeIfPresent(String.self, forKey: .note)
        reminderID = try c.decodeIfPresent(String.self, forKey: .reminderID)
    }
}

extension PlannedExercise {
    /// 配重文案：「自重」/「60.0kg」/「待定」。
    /// 计划卡片、.ics 导出与 AI 计划变更摘要都走这里，口径只此一份。
    var weightLabel: String {
        if CalorieEstimator.isBodyweight(name) { return "自重" }
        return targetWeightKG > 0 ? String(format: "%.1fkg", targetWeightKG) : "待定"
    }

    /// 「4×8 60.0kg」/「4×8 自重」
    var targetLabel: String { "\(targetSets)×\(targetReps) \(weightLabel)" }
}

// MARK: - 身体数据

struct BodyMetric: Codable, Hashable, Identifiable {
    var id: UUID = UUID()
    var date: Date
    var weightKG: Double
    var bodyFatPct: Double?
    var muscleMassKG: Double?
    var waistCM: Double?
    var chestCM: Double?
    var armCM: Double?
    var thighCM: Double?
}

struct Goal: Codable, Hashable {
    var type: GoalType = .bulk
    var targetWeightKG: Double = 75
    var targetBodyFatPct: Double?
    var weeklyTargetDeltaKG: Double = 0.25
}

struct UserProfile: Codable, Hashable {
    var sex: String = "male"
    var age: Int = 25
    var heightCM: Double = 175
    var activityLevel: Double = 1.55
    var trainingDaysPerWeek: Int = 4
}

/// 三大项极限重量（1RM，kg）。手填优先，未填时回退到历史训练估算。
struct BigThreeMax: Codable, Hashable {
    var benchKG: Double?
    var squatKG: Double?
    var deadliftKG: Double?

    var isEmpty: Bool { benchKG == nil && squatKG == nil && deadliftKG == nil }
}

// MARK: - 动作库 / 食物库 / 饮食记录

struct ExerciseDef: Codable, Hashable, Identifiable {
    var id: UUID = UUID()
    var name: String
    var muscleGroup: String
    var equipment: String
    var isBodyweight: Bool = false

    private enum CodingKeys: String, CodingKey {
        case id, name, muscleGroup, equipment, isBodyweight
    }

    init(id: UUID = UUID(), name: String, muscleGroup: String, equipment: String,
         isBodyweight: Bool = false) {
        self.id = id
        self.name = name
        self.muscleGroup = muscleGroup
        self.equipment = equipment
        self.isBodyweight = isBodyweight
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        muscleGroup = try c.decode(String.self, forKey: .muscleGroup)
        equipment = try c.decode(String.self, forKey: .equipment)
        isBodyweight = try c.decodeIfPresent(Bool.self, forKey: .isBodyweight) ?? false
    }
}

struct Food: Codable, Hashable, Identifiable {
    var id: UUID = UUID()
    var name: String
    var kcalPer100g: Double
    var proteinPer100g: Double
    var carbPer100g: Double
    var fatPer100g: Double
}

struct DietLog: Codable, Hashable, Identifiable {
    var id: UUID = UUID()
    var date: Date
    var foodName: String
    var amountG: Double
    var foodId: UUID? = nil
    var kcal: Double? = nil
    var protein: Double? = nil
    var carb: Double? = nil
    var fat: Double? = nil
    var source: String? = nil
    var imageName: String? = nil
}

enum DietEvaluationStatus: String, Codable, Hashable {
    case insufficient, withinRange, deviating, suggested, accepted, dismissed
}

struct DietEvaluation: Codable, Hashable, Identifiable {
    var id: UUID = UUID()
    var earliestWindowStart: String
    var earliestWindowEnd: String
    var latestWindowStart: String
    var latestWindowEnd: String
    var earliestAverageKG: Double?
    var latestAverageKG: Double?
    var earliestPointCount: Int
    var latestPointCount: Int
    var days: Double?
    var goalType: GoalType
    var targetWeeklyDeltaKG: Double
    var actualWeeklyDeltaKG: Double?
    var deviationKGPerWeek: Double?
    var suggestedAdjustmentKcal: Double?
    var appliedAdjustmentKcal: Double?
    var status: DietEvaluationStatus
    var createdAt: Date
    var decidedAt: Date?

    private enum CodingKeys: String, CodingKey {
        case id, previousWindowStart, previousWindowEnd, currentWindowStart, currentWindowEnd
        case previousAverageKG, currentAverageKG, previousPointCount, currentPointCount, days
        case goalType, weeklyTargetDeltaKG, actualWeeklyDelta, deviation
        case suggestedAdjustmentKcal, appliedAdjustmentKcal, status, createdAt, decidedAt
        case earliestWindowStart, earliestWindowEnd, latestWindowStart, latestWindowEnd
        case earliestAverageKG, latestAverageKG, earliestPointCount, latestPointCount
        case targetWeeklyDeltaKG, actualWeeklyDeltaKG, deviationKGPerWeek
    }

    init(id: UUID = UUID(), earliestWindowStart: String, earliestWindowEnd: String,
         latestWindowStart: String, latestWindowEnd: String, earliestAverageKG: Double?,
         latestAverageKG: Double?, earliestPointCount: Int, latestPointCount: Int,
         days: Double?, goalType: GoalType, targetWeeklyDeltaKG: Double,
         actualWeeklyDeltaKG: Double?, deviationKGPerWeek: Double?,
         suggestedAdjustmentKcal: Double?, appliedAdjustmentKcal: Double?,
         status: DietEvaluationStatus, createdAt: Date, decidedAt: Date?) {
        self.id = id
        self.earliestWindowStart = earliestWindowStart
        self.earliestWindowEnd = earliestWindowEnd
        self.latestWindowStart = latestWindowStart
        self.latestWindowEnd = latestWindowEnd
        self.earliestAverageKG = earliestAverageKG
        self.latestAverageKG = latestAverageKG
        self.earliestPointCount = earliestPointCount
        self.latestPointCount = latestPointCount
        self.days = days
        self.goalType = goalType
        self.targetWeeklyDeltaKG = targetWeeklyDeltaKG
        self.actualWeeklyDeltaKG = actualWeeklyDeltaKG
        self.deviationKGPerWeek = deviationKGPerWeek
        self.suggestedAdjustmentKcal = suggestedAdjustmentKcal
        self.appliedAdjustmentKcal = appliedAdjustmentKcal
        self.status = status
        self.createdAt = createdAt
        self.decidedAt = decidedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func string(_ current: CodingKeys, _ legacy: CodingKeys) throws -> String {
            let value = try c.decodeIfPresent(String.self, forKey: current)
                ?? c.decode(String.self, forKey: legacy)
            guard value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else {
                throw DecodingError.dataCorruptedError(forKey: current, in: c,
                                                       debugDescription: "窗口日期必须为本地 YYYY-MM-DD")
            }
            return value
        }
        id = try c.decode(UUID.self, forKey: .id)
        earliestWindowStart = try string(.previousWindowStart, .earliestWindowStart)
        earliestWindowEnd = try string(.previousWindowEnd, .earliestWindowEnd)
        latestWindowStart = try string(.currentWindowStart, .latestWindowStart)
        latestWindowEnd = try string(.currentWindowEnd, .latestWindowEnd)
        earliestAverageKG = try c.decodeIfPresent(Double.self, forKey: .previousAverageKG)
            ?? c.decodeIfPresent(Double.self, forKey: .earliestAverageKG)
        latestAverageKG = try c.decodeIfPresent(Double.self, forKey: .currentAverageKG)
            ?? c.decodeIfPresent(Double.self, forKey: .latestAverageKG)
        earliestPointCount = try c.decodeIfPresent(Int.self, forKey: .previousPointCount)
            ?? c.decode(Int.self, forKey: .earliestPointCount)
        latestPointCount = try c.decodeIfPresent(Int.self, forKey: .currentPointCount)
            ?? c.decode(Int.self, forKey: .latestPointCount)
        days = try c.decodeIfPresent(Double.self, forKey: .days)
        goalType = try c.decode(GoalType.self, forKey: .goalType)
        targetWeeklyDeltaKG = try c.decodeIfPresent(Double.self, forKey: .weeklyTargetDeltaKG)
            ?? c.decode(Double.self, forKey: .targetWeeklyDeltaKG)
        actualWeeklyDeltaKG = try c.decodeIfPresent(Double.self, forKey: .actualWeeklyDelta)
            ?? c.decodeIfPresent(Double.self, forKey: .actualWeeklyDeltaKG)
        deviationKGPerWeek = try c.decodeIfPresent(Double.self, forKey: .deviation)
            ?? c.decodeIfPresent(Double.self, forKey: .deviationKGPerWeek)
        suggestedAdjustmentKcal = try c.decodeIfPresent(Double.self, forKey: .suggestedAdjustmentKcal)
        appliedAdjustmentKcal = try c.decodeIfPresent(Double.self, forKey: .appliedAdjustmentKcal)
        status = try c.decode(DietEvaluationStatus.self, forKey: .status)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        decidedAt = try c.decodeIfPresent(Date.self, forKey: .decidedAt)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(earliestWindowStart, forKey: .previousWindowStart)
        try c.encode(earliestWindowEnd, forKey: .previousWindowEnd)
        try c.encode(latestWindowStart, forKey: .currentWindowStart)
        try c.encode(latestWindowEnd, forKey: .currentWindowEnd)
        try c.encode(earliestAverageKG ?? 0, forKey: .previousAverageKG)
        try c.encode(latestAverageKG ?? 0, forKey: .currentAverageKG)
        try c.encode(earliestPointCount, forKey: .previousPointCount)
        try c.encode(latestPointCount, forKey: .currentPointCount)
        try c.encode(days ?? 0, forKey: .days)
        try c.encode(goalType, forKey: .goalType)
        try c.encode(targetWeeklyDeltaKG, forKey: .weeklyTargetDeltaKG)
        try c.encode(actualWeeklyDeltaKG ?? 0, forKey: .actualWeeklyDelta)
        try c.encode(deviationKGPerWeek ?? 0, forKey: .deviation)
        try c.encode(suggestedAdjustmentKcal ?? 0, forKey: .suggestedAdjustmentKcal)
        try c.encode(appliedAdjustmentKcal ?? 0, forKey: .appliedAdjustmentKcal)
        try c.encode(status, forKey: .status)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encodeIfPresent(decidedAt, forKey: .decidedAt)
    }
}

struct DietCalibration: Codable, Hashable, Identifiable {
    var id: String { "dietCalibration" }
    var currentAdjustmentKcal: Double = 0
    var evaluations: [DietEvaluation] = []

    private enum CodingKeys: String, CodingKey {
        case currentAdjustmentKcal, evaluations
    }

    init(currentAdjustmentKcal: Double = 0, evaluations: [DietEvaluation] = []) {
        self.currentAdjustmentKcal = currentAdjustmentKcal
        self.evaluations = evaluations
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        currentAdjustmentKcal = try c.decodeIfPresent(Double.self, forKey: .currentAdjustmentKcal) ?? 0
        evaluations = try c.decodeIfPresent([DietEvaluation].self, forKey: .evaluations) ?? []
    }
}

// MARK: - AI 聊天

struct ChatMessage: Codable, Hashable, Identifiable {
    var id: UUID = UUID()
    var role: String   // "user" / "assistant"
    var content: String
    /// AI 提议的资料变更（原始 JSON），非空时聊天里渲染确认卡片
    var proposal: String? = nil
    /// nil = 待处理，"applied" / "dismissed" = 已终结
    var proposalStatus: String? = nil
    /// 应用后的变更摘要，用于在聊天里回显实际改了什么
    var proposalResult: [String]? = nil

    var isProposalPending: Bool { proposal != nil && (proposalStatus ?? "").isEmpty }
}

// MARK: - AI 资料变更载荷

/// AI 可以提议修改的个人资料字段（白名单）。单个字段缺失即不改。
struct AIUpdatePayload: Codable {
    struct ProfilePatch: Codable {
        var sex: String?
        var age: Int?
        var heightCM: Double?
        var activityLevel: Double?
        var trainingDaysPerWeek: Int?
    }
    struct GoalPatch: Codable {
        var type: String?
        var targetWeightKG: Double?
        var targetBodyFatPct: Double?
        var weeklyTargetDeltaKG: Double?
    }
    struct BigThreePatch: Codable {
        var benchKG: Double?
        var squatKG: Double?
        var deadliftKG: Double?
    }

    /// AI 对今日训练计划的修改。exercises 是调整后的「完整动作列表」——
    /// 未改动的动作也要原样带上，落地时整体替换，预览卡片展示的就是最终结果。
    struct PlanPatch: Codable {
        struct ExercisePatch: Codable {
            /// 用可选：模型漏写或写坏一条时，不至于把整个载荷（含资料变更）一起丢掉
            var name: String?
            var targetSets: Int?
            var targetReps: Int?
            var targetWeightKG: Double?
        }

        /// 新的计划名称（如「胸」「肩+三头」）；nil 表示不改名
        var splitName: String?
        /// 调整后的完整动作列表；nil 或空数组表示不改动作
        var exercises: [ExercisePatch]?

        /// 无名条目会被落地逻辑丢弃，不算一次改动
        var exerciseCount: Int {
            (exercises ?? []).filter { !($0.name ?? "").trimmingCharacters(in: .whitespaces).isEmpty }.count
        }
        var hasAnyChange: Bool { splitName != nil || exerciseCount > 0 }
    }

    var profile: ProfilePatch?
    var goal: GoalPatch?
    var bigThree: BigThreePatch?
    /// 今日训练计划的调整（与网页版同一套协议）
    var plan: PlanPatch?
    /// 追加到 AppData.coachNotes 的长期偏好/约束
    var notes: [String]?
    /// 一句话说明改动理由，显示在确认卡片上
    var reason: String?

    var hasAnyChange: Bool {
        func any<T>(_ p: T?, _ has: (T) -> Bool) -> Bool { p.map(has) ?? false }
        return any(profile) { $0.sex != nil || $0.age != nil || $0.heightCM != nil
                            || $0.activityLevel != nil || $0.trainingDaysPerWeek != nil }
            || any(goal) { $0.type != nil || $0.targetWeightKG != nil
                          || $0.targetBodyFatPct != nil || $0.weeklyTargetDeltaKG != nil }
            || any(bigThree) { $0.benchKG != nil || $0.squatKG != nil || $0.deadliftKG != nil }
            || any(plan) { $0.hasAnyChange }
            || !(notes ?? []).filter({ !$0.trimmingCharacters(in: .whitespaces).isEmpty }).isEmpty
    }
}

// MARK: - 根数据

struct AppData: Codable {
    static let currentSchemaVersion = 3

    var schemaVersion: Int? = AppData.currentSchemaVersion
    var createdAt: Date? = Date()
    var updatedAt: Date? = Date()
    var profile: UserProfile = UserProfile()
    var goal: Goal = Goal()
    var workouts: [WorkoutSession] = []
    var plannedWorkouts: [PlannedWorkout] = []
    var bodyMetrics: [BodyMetric] = []
    var foods: [Food] = []
    var exercises: [ExerciseDef] = []
    var dietLogs: [DietLog] = []
    var dietCalibration: DietCalibration = DietCalibration()
    /// 三大项极限重量（手填优先）
    var bigThree: BigThreeMax? = nil
    /// 用户在对话中表达的长期偏好与约束，会注入 AI 上下文
    var coachNotes: [String]? = nil

    init(schemaVersion: Int? = AppData.currentSchemaVersion,
         createdAt: Date? = Date(), updatedAt: Date? = Date(),
         profile: UserProfile = UserProfile(), goal: Goal = Goal(),
         workouts: [WorkoutSession] = [], plannedWorkouts: [PlannedWorkout] = [],
         bodyMetrics: [BodyMetric] = [], foods: [Food] = [], exercises: [ExerciseDef] = [],
         dietLogs: [DietLog] = [], dietCalibration: DietCalibration = DietCalibration(),
         bigThree: BigThreeMax? = nil, coachNotes: [String]? = nil) {
        self.schemaVersion = schemaVersion
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.profile = profile
        self.goal = goal
        self.workouts = workouts
        self.plannedWorkouts = plannedWorkouts
        self.bodyMetrics = bodyMetrics
        self.foods = foods
        self.exercises = exercises
        self.dietLogs = dietLogs
        self.dietCalibration = dietCalibration
        self.bigThree = bigThree
        self.coachNotes = coachNotes
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, createdAt, updatedAt, profile, goal, workouts, plannedWorkouts
        case bodyMetrics, foods, exercises, dietLogs, dietCalibration, bigThree, coachNotes
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try c.decodeIfPresent(Int.self, forKey: .schemaVersion)
        createdAt = try c.decodeIfPresent(Date.self, forKey: .createdAt)
        updatedAt = try c.decodeIfPresent(Date.self, forKey: .updatedAt)
        profile = try c.decodeIfPresent(UserProfile.self, forKey: .profile) ?? UserProfile()
        goal = try c.decodeIfPresent(Goal.self, forKey: .goal) ?? Goal()
        workouts = try c.decodeIfPresent([WorkoutSession].self, forKey: .workouts) ?? []
        plannedWorkouts = try c.decodeIfPresent([PlannedWorkout].self, forKey: .plannedWorkouts) ?? []
        bodyMetrics = try c.decodeIfPresent([BodyMetric].self, forKey: .bodyMetrics) ?? []
        foods = try c.decodeIfPresent([Food].self, forKey: .foods) ?? []
        exercises = try c.decodeIfPresent([ExerciseDef].self, forKey: .exercises) ?? []
        dietLogs = try c.decodeIfPresent([DietLog].self, forKey: .dietLogs) ?? []
        dietCalibration = try c.decodeIfPresent(DietCalibration.self, forKey: .dietCalibration) ?? DietCalibration()
        bigThree = try c.decodeIfPresent(BigThreeMax.self, forKey: .bigThree)
        coachNotes = try c.decodeIfPresent([String].self, forKey: .coachNotes)
    }
}

// MARK: - 种子数据

enum SeedData {
    static let exercises: [ExerciseDef] = [
        .init(name: "杠铃卧推", muscleGroup: "胸", equipment: "杠铃"),
        .init(name: "上斜哑铃卧推", muscleGroup: "胸", equipment: "哑铃"),
        .init(name: "站姿推举", muscleGroup: "肩", equipment: "杠铃"),
        .init(name: "哑铃侧平举", muscleGroup: "肩", equipment: "哑铃"),
        .init(name: "杠铃划船", muscleGroup: "背", equipment: "杠铃"),
        .init(name: "坐姿划船", muscleGroup: "背", equipment: "绳索"),
        .init(name: "高位下拉", muscleGroup: "背", equipment: "绳索"),
        .init(name: "引体向上", muscleGroup: "背", equipment: "自重", isBodyweight: true),
        .init(name: "面拉", muscleGroup: "肩", equipment: "绳索"),
        .init(name: "杠铃深蹲", muscleGroup: "腿", equipment: "杠铃"),
        .init(name: "罗马尼亚硬拉", muscleGroup: "腿", equipment: "杠铃"),
        .init(name: "硬拉", muscleGroup: "背", equipment: "杠铃"),
        .init(name: "腿举", muscleGroup: "腿", equipment: "器械"),
        .init(name: "腿屈伸", muscleGroup: "腿", equipment: "器械"),
        .init(name: "腿弯举", muscleGroup: "腿", equipment: "器械"),
        .init(name: "站姿提踵", muscleGroup: "小腿", equipment: "器械"),
        .init(name: "坐姿提踵", muscleGroup: "小腿", equipment: "器械"),
        .init(name: "保加利亚分腿蹲", muscleGroup: "腿", equipment: "哑铃"),
        .init(name: "臀桥", muscleGroup: "臀", equipment: "杠铃"),
        .init(name: "哑铃弯举", muscleGroup: "二头", equipment: "哑铃"),
        .init(name: "锤式弯举", muscleGroup: "二头", equipment: "哑铃"),
        .init(name: "绳索下压", muscleGroup: "三头", equipment: "绳索"),
        .init(name: "仰卧臂屈伸", muscleGroup: "三头", equipment: "哑铃"),
    ]

    static let foods: [Food] = [
        .init(name: "鸡胸肉", kcalPer100g: 165, proteinPer100g: 31, carbPer100g: 0, fatPer100g: 3.6),
        .init(name: "鸡蛋", kcalPer100g: 143, proteinPer100g: 12.6, carbPer100g: 0.7, fatPer100g: 9.5),
        .init(name: "瘦牛肉", kcalPer100g: 250, proteinPer100g: 26, carbPer100g: 0, fatPer100g: 15),
        .init(name: "三文鱼", kcalPer100g: 208, proteinPer100g: 20, carbPer100g: 0, fatPer100g: 13),
        .init(name: "米饭(熟)", kcalPer100g: 116, proteinPer100g: 2.6, carbPer100g: 25.9, fatPer100g: 0.3),
        .init(name: "燕麦", kcalPer100g: 389, proteinPer100g: 16.9, carbPer100g: 66, fatPer100g: 6.9),
        .init(name: "全麦面包", kcalPer100g: 247, proteinPer100g: 13, carbPer100g: 41, fatPer100g: 3.4),
        .init(name: "红薯", kcalPer100g: 86, proteinPer100g: 1.6, carbPer100g: 20, fatPer100g: 0.1),
        .init(name: "香蕉", kcalPer100g: 89, proteinPer100g: 1.1, carbPer100g: 23, fatPer100g: 0.3),
        .init(name: "花生酱", kcalPer100g: 588, proteinPer100g: 25, carbPer100g: 20, fatPer100g: 50),
        .init(name: "牛奶", kcalPer100g: 61, proteinPer100g: 3.2, carbPer100g: 4.8, fatPer100g: 3.3),
        .init(name: "希腊酸奶", kcalPer100g: 59, proteinPer100g: 10, carbPer100g: 3.6, fatPer100g: 0.4),
        .init(name: "西兰花", kcalPer100g: 34, proteinPer100g: 2.8, carbPer100g: 7, fatPer100g: 0.4),
        .init(name: "橄榄油", kcalPer100g: 884, proteinPer100g: 0, carbPer100g: 0, fatPer100g: 100),
        .init(name: "乳清蛋白粉", kcalPer100g: 400, proteinPer100g: 80, carbPer100g: 10, fatPer100g: 5),
        .init(name: "杏仁", kcalPer100g: 579, proteinPer100g: 21, carbPer100g: 22, fatPer100g: 50),
    ]
}
