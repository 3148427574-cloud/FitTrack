import Foundation

enum RestoreMode: String, CaseIterable, Identifiable {
    case replace
    case merge
    var id: String { rawValue }
    var label: String { self == .replace ? "完整替换" : "安全合并" }
}

enum RestoreConflictPolicy: String, CaseIterable, Identifiable {
    case local
    case backup
    var id: String { rawValue }
    var label: String { self == .local ? "保留本地" : "使用备份" }
}

struct RestoreIssue: Identifiable, Hashable {
    let id = UUID()
    var path: String
    var message: String
    var blocking = false

    var description: String { "\(path)：\(message)" }
}

struct RestoreStats {
    var added = 0
    var updated = 0
    var ignored = 0
    var skipped = 0

    mutating func add(_ other: RestoreStats) {
        added += other.added
        updated += other.updated
        ignored += other.ignored
        skipped += other.skipped
    }

    var summary: String { "新增 \(added)，更新 \(updated)，忽略 \(ignored)，跳过 \(skipped)" }
}

struct BackupPreview {
    var data: AppData
    var chat: [ChatMessage]
    var schemaVersion: Int
    var presentFields: Set<String>
    var issues: [RestoreIssue]
    var skipped: Int

    var canApply: Bool {
        schemaVersion <= AppData.currentSchemaVersion && !issues.contains(where: \ .blocking)
    }

    func fieldDescription(_ key: String, count: Int) -> String {
        presentFields.contains(key) ? "\(key): \(count)" : "\(key): 缺失（将按旧版本迁移）"
    }
}

struct RestoreCandidate {
    var data: AppData
    var chat: [ChatMessage]
    var stats: RestoreStats
    var issues: [RestoreIssue]
}

enum BackupRecoveryError: LocalizedError {
    case invalidJSON
    case notObject
    case futureVersion(Int)
    case invalidCriticalFields
    case rollbackFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidJSON: return "备份 JSON 无法解析"
        case .notObject: return "备份顶层必须是 JSON 对象"
        case .futureVersion(let version): return "备份版本 v\(version) 高于当前支持的 v\(AppData.currentSchemaVersion)"
        case .invalidCriticalFields: return "备份包含阻断问题，不能安全恢复"
        case .rollbackFailed(let details): return "恢复写入失败且回滚失败：\(details)"
        }
    }
}

enum BackupRecovery {
    private static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    static func parse(_ text: String) throws -> BackupPreview {
        guard let raw = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: raw) else {
            throw BackupRecoveryError.invalidJSON
        }
        guard let object = json as? [String: Any] else { throw BackupRecoveryError.notObject }

        let fields = Set(object.keys)
        var issues: [RestoreIssue] = []
        let version: Int
        if let value = object["schemaVersion"] {
            if !(value is Bool), let number = value as? NSNumber,
               number.doubleValue.isFinite, number.doubleValue > 0,
               number.doubleValue.rounded(.towardZero) == number.doubleValue,
               number.doubleValue <= Double(Int.max) {
                version = number.intValue
            } else {
                version = 0
                issues.append(.init(path: "schemaVersion", message: "必须是正整数", blocking: true))
            }
        } else {
            version = 1
        }

        if version > AppData.currentSchemaVersion {
            issues.append(.init(path: "schemaVersion", message: "未来版本 v\(version)，当前仅支持 v\(AppData.currentSchemaVersion)", blocking: true))
        }

        let createdAt = decode(Date.self, object["createdAt"])
        let updatedAt = decode(Date.self, object["updatedAt"])
        if fields.contains("createdAt"), !(object["createdAt"] is NSNull), createdAt == nil {
            issues.append(.init(path: "createdAt", message: "日期无效", blocking: true))
        }
        if fields.contains("updatedAt"), !(object["updatedAt"] is NSNull), updatedAt == nil {
            issues.append(.init(path: "updatedAt", message: "日期无效", blocking: true))
        }
        var data = AppData(schemaVersion: AppData.currentSchemaVersion,
                           createdAt: createdAt, updatedAt: updatedAt)

        if let value = object["profile"] {
            if let profile = decode(UserProfile.self, value), validate(profile) {
                data.profile = profile
            } else {
                issues.append(.init(path: "profile", message: "字段损坏或包含无效数值", blocking: true))
            }
        } else {
            issues.append(.init(path: "profile", message: "关键配置缺失，不能静默使用默认值", blocking: true))
        }

        if let value = object["goal"] {
            if let goal = decode(Goal.self, value), validate(goal) {
                data.goal = goal
            } else {
                issues.append(.init(path: "goal", message: "字段损坏、枚举无效或包含无效数值", blocking: true))
            }
        } else {
            issues.append(.init(path: "goal", message: "关键配置缺失，不能静默使用默认值", blocking: true))
        }

        var skipped = 0
        data.workouts = decodeItems(WorkoutSession.self, key: "workouts", object: object,
                                    issues: &issues, skipped: &skipped, validate: validate)
        data.plannedWorkouts = decodeItems(PlannedWorkout.self, key: "plannedWorkouts", object: object,
                                           issues: &issues, skipped: &skipped, validate: validate)
        data.bodyMetrics = decodeItems(BodyMetric.self, key: "bodyMetrics", object: object,
                                       issues: &issues, skipped: &skipped, validate: validate)
        data.foods = decodeItems(Food.self, key: "foods", object: object,
                                 issues: &issues, skipped: &skipped, validate: validate)
        data.exercises = decodeItems(ExerciseDef.self, key: "exercises", object: object,
                                     issues: &issues, skipped: &skipped, validate: validate)
        data.dietLogs = decodeItems(DietLog.self, key: "dietLogs", object: object,
                                    issues: &issues, skipped: &skipped, validate: validate)
        var chat = decodeItems(ChatMessage.self, key: "chat", object: object,
                               issues: &issues, skipped: &skipped, validate: { _ in true })

        data.bigThree = decodeOptional(BigThreeMax.self, key: "bigThree", object: object,
                                       issues: &issues, validate: validate)
        data.coachNotes = decodeOptional([String].self, key: "coachNotes", object: object,
                                         issues: &issues, validate: { _ in true })

        if !fields.contains("foods") { data.foods = SeedData.foods }
        if !fields.contains("exercises") { data.exercises = SeedData.exercises }
        data.schemaVersion = AppData.currentSchemaVersion
        chat = unique(chat, key: \ .id, path: "chat", issues: &issues, skipped: &skipped)
        data.workouts = unique(data.workouts, key: \ .id, path: "workouts", issues: &issues, skipped: &skipped)
        data.plannedWorkouts = unique(data.plannedWorkouts, key: \ .id, path: "plannedWorkouts", issues: &issues, skipped: &skipped)
        data.bodyMetrics = unique(data.bodyMetrics, key: \ .id, path: "bodyMetrics", issues: &issues, skipped: &skipped)
        data.foods = unique(data.foods, key: \ .id, path: "foods", issues: &issues, skipped: &skipped)
        data.exercises = unique(data.exercises, key: \ .id, path: "exercises", issues: &issues, skipped: &skipped)
        data.dietLogs = unique(data.dietLogs, key: \ .id, path: "dietLogs", issues: &issues, skipped: &skipped)

        return BackupPreview(data: data, chat: chat, schemaVersion: version,
                             presentFields: fields, issues: issues, skipped: skipped)
    }

    static func candidate(from preview: BackupPreview, local: AppData, localChat: [ChatMessage],
                          mode: RestoreMode, policy: RestoreConflictPolicy) throws -> RestoreCandidate {
        guard preview.schemaVersion <= AppData.currentSchemaVersion else {
            throw BackupRecoveryError.futureVersion(preview.schemaVersion)
        }
        guard preview.canApply else { throw BackupRecoveryError.invalidCriticalFields }
        var stats = RestoreStats(skipped: preview.skipped)
        if mode == .replace {
            stats.added = preview.data.workouts.count + preview.data.plannedWorkouts.count
                + preview.data.bodyMetrics.count + preview.data.foods.count + preview.data.exercises.count
                + preview.data.dietLogs.count + preview.chat.count
            return RestoreCandidate(data: preview.data, chat: preview.chat, stats: stats, issues: preview.issues)
        }

        var result = local
        result.profile = mergeValue(local.profile, preview.data.profile, present: preview.presentFields.contains("profile"),
                                    policy: policy, stats: &stats)
        result.goal = mergeValue(local.goal, preview.data.goal, present: preview.presentFields.contains("goal"),
                                 policy: policy, stats: &stats)
        result.workouts = merge(local.workouts, preview.data.workouts, policy: policy, stats: &stats)
        result.plannedWorkouts = merge(local.plannedWorkouts, preview.data.plannedWorkouts, policy: policy, stats: &stats)
        result.bodyMetrics = merge(local.bodyMetrics, preview.data.bodyMetrics, policy: policy, stats: &stats)
        result.foods = merge(local.foods, preview.data.foods, policy: policy, stats: &stats)
        result.exercises = merge(local.exercises, preview.data.exercises, policy: policy, stats: &stats)
        result.dietLogs = merge(local.dietLogs, preview.data.dietLogs, policy: policy, stats: &stats)
        result.bigThree = mergeOptional(local.bigThree, preview.data.bigThree,
                                        present: preview.presentFields.contains("bigThree"), policy: policy, stats: &stats)
        result.coachNotes = mergeOptional(local.coachNotes, preview.data.coachNotes,
                                          present: preview.presentFields.contains("coachNotes"), policy: policy, stats: &stats)
        let chat = merge(localChat, preview.chat, policy: policy, stats: &stats)
        result.schemaVersion = AppData.currentSchemaVersion
        result.createdAt = local.createdAt ?? preview.data.createdAt
        result.updatedAt = preview.data.updatedAt ?? local.updatedAt
        return RestoreCandidate(data: result, chat: chat, stats: stats, issues: preview.issues)
    }

    private static func decode<T: Decodable>(_ type: T.Type, _ value: Any?) -> T? {
        guard let value,
              let raw = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) else { return nil }
        return try? decoder().decode(type, from: raw)
    }

    private static func decodeItems<T: Decodable>(_ type: T.Type, key: String, object: [String: Any],
                                                   issues: inout [RestoreIssue], skipped: inout Int,
                                                   validate: (T) -> Bool) -> [T] {
        guard let value = object[key] else { return [] }
        guard let array = value as? [Any] else {
            issues.append(.init(path: key, message: "必须是数组", blocking: true)); return []
        }
        var result: [T] = []
        for (index, item) in array.enumerated() {
            if let decoded = decode(type, item), validate(decoded) {
                result.append(decoded)
            } else {
                issues.append(.init(path: "\(key)[\(index)]", message: "条目损坏或包含无效值，已跳过"))
                skipped += 1
            }
        }
        return result
    }

    private static func decodeOptional<T: Decodable>(_ type: T.Type, key: String, object: [String: Any],
                                                       issues: inout [RestoreIssue], validate: (T) -> Bool) -> T? {
        guard let value = object[key], !(value is NSNull) else { return nil }
        guard let decoded = decode(type, value), validate(decoded) else {
            issues.append(.init(path: key, message: "字段损坏或包含无效值，已跳过", blocking: true)); return nil
        }
        return decoded
    }

    private static func unique<T, ID: Hashable>(_ values: [T], key: KeyPath<T, ID>, path: String,
                                                 issues: inout [RestoreIssue], skipped: inout Int) -> [T] {
        var seen = Set<ID>()
        return values.filter { value in
            if seen.insert(value[keyPath: key]).inserted { return true }
            skipped += 1
            issues.append(.init(path: path, message: "发现重复 ID，已保留第一条"))
            return false
        }
    }

    private static func merge<T: Identifiable & Hashable>(_ local: [T], _ backup: [T],
                                                            policy: RestoreConflictPolicy,
                                                            stats: inout RestoreStats) -> [T] where T.ID: Hashable {
        var result: [T] = []
        var index: [T.ID: Int] = [:]
        for value in local {
            guard index[value.id] == nil else { stats.ignored += 1; continue }
            index[value.id] = result.count
            result.append(value)
        }
        for value in backup {
            guard let current = index[value.id] else {
                index[value.id] = result.count; result.append(value); stats.added += 1; continue
            }
            if result[current] == value { stats.ignored += 1 }
            else if policy == .backup { result[current] = value; stats.updated += 1 }
            else { stats.ignored += 1 }
        }
        return result
    }

    private static func mergeValue<T: Hashable>(_ local: T, _ backup: T, present: Bool,
                                                  policy: RestoreConflictPolicy, stats: inout RestoreStats) -> T {
        guard present else { stats.ignored += 1; return local }
        if local == backup { stats.ignored += 1; return local }
        if policy == .backup { stats.updated += 1; return backup }
        stats.ignored += 1; return local
    }

    private static func mergeOptional<T: Hashable>(_ local: T?, _ backup: T?, present: Bool,
                                                     policy: RestoreConflictPolicy, stats: inout RestoreStats) -> T? {
        guard present else { stats.ignored += 1; return local }
        if local == backup { stats.ignored += 1; return local }
        if policy == .backup { stats.updated += 1; return backup }
        stats.ignored += 1; return local
    }

    private static func finite(_ values: Double?...) -> Bool { values.allSatisfy { $0?.isFinite ?? true } }
    private static func nonnegative(_ values: Double?...) -> Bool {
        finite(values.map { $0 }) && values.allSatisfy { ($0 ?? 0) >= 0 }
    }
    private static func finite(_ values: [Double?]) -> Bool { values.allSatisfy { $0?.isFinite ?? true } }
    private static func hasUniqueIDs<T: Identifiable>(_ values: [T]) -> Bool where T.ID: Hashable {
        Set(values.map(\.id)).count == values.count
    }

    private static func validate(_ value: UserProfile) -> Bool {
        value.age >= 0 && value.trainingDaysPerWeek >= 0
            && nonnegative(value.heightCM, value.activityLevel)
    }
    private static func validate(_ value: Goal) -> Bool {
        nonnegative(value.targetWeightKG, value.targetBodyFatPct, value.weeklyTargetDeltaKG)
    }
    private static func validate(_ value: WorkoutSession) -> Bool {
        nonnegative(value.durationMin) && hasUniqueIDs(value.exercises) && value.exercises.allSatisfy {
            finite($0.rpe) && $0.sets.allSatisfy { $0.reps >= 0 && nonnegative($0.weightKG) }
        }
    }
    private static func validate(_ value: PlannedWorkout) -> Bool {
        hasUniqueIDs(value.exercises) && value.exercises.allSatisfy {
            $0.targetSets >= 0 && $0.targetReps >= 0 && nonnegative($0.targetWeightKG)
        }
    }
    private static func validate(_ value: BodyMetric) -> Bool {
        nonnegative(value.weightKG, value.bodyFatPct, value.muscleMassKG, value.waistCM,
                    value.chestCM, value.armCM, value.thighCM)
    }
    private static func validate(_ value: Food) -> Bool {
        nonnegative(value.kcalPer100g, value.proteinPer100g, value.carbPer100g, value.fatPer100g)
    }
    private static func validate(_ value: ExerciseDef) -> Bool {
        true
    }
    private static func validate(_ value: DietLog) -> Bool {
        nonnegative(value.amountG, value.kcal, value.protein, value.carb, value.fat)
            && (value.source == nil || value.source == "manual" || value.source == "image")
    }
    private static func validate(_ value: BigThreeMax) -> Bool {
        nonnegative(value.benchKG, value.squatKG, value.deadliftKG)
    }
}
