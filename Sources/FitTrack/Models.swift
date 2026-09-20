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

    var profile: ProfilePatch?
    var goal: GoalPatch?
    var bigThree: BigThreePatch?
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
            || !(notes ?? []).filter({ !$0.trimmingCharacters(in: .whitespaces).isEmpty }).isEmpty
    }
}

// MARK: - 根数据

struct AppData: Codable {
    var profile: UserProfile = UserProfile()
    var goal: Goal = Goal()
    var workouts: [WorkoutSession] = []
    var plannedWorkouts: [PlannedWorkout] = []
    var bodyMetrics: [BodyMetric] = []
    var foods: [Food] = []
    var exercises: [ExerciseDef] = []
    var dietLogs: [DietLog] = []
    /// 三大项极限重量（手填优先）
    var bigThree: BigThreeMax? = nil
    /// 用户在对话中表达的长期偏好与约束，会注入 AI 上下文
    var coachNotes: [String]? = nil
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
