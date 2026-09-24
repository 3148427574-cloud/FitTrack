import Foundation
import SwiftUI

/// 全局数据仓库：负责加载/保存 JSON 文件，并暴露便于 UI 使用的查询。
final class AppStore: ObservableObject {
    @Published var data: AppData
    @Published var chatMessages: [ChatMessage]
    private let fileURL: URL
    private let chatURL: URL

    init() {
        let url = AppStore.defaultFileURL()
        self.fileURL = url
        self.chatURL = url.deletingLastPathComponent().appendingPathComponent("chat.json")
        let persisted = try? Data(contentsOf: url)
        let fields = persisted.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        if let persisted, let loaded = AppStore.decodeData(persisted) {
            self.data = loaded
        } else {
            self.data = AppData()
        }
        self.chatMessages = AppStore.loadChat(from: chatURL) ?? []
        if persisted == nil || fields?["exercises"] == nil { data.exercises = SeedData.exercises }
        if persisted == nil || fields?["foods"] == nil { data.foods = SeedData.foods }
    }

    static func loadChat(from url: URL) -> [ChatMessage]? {
        guard let d = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode([ChatMessage].self, from: d)
    }

    func saveChat() {
        if let d = try? JSONEncoder().encode(chatMessages) {
            try? d.write(to: chatURL, options: .atomic)
        }
    }

    func appendChat(_ m: ChatMessage) {
        objectWillChange.send()
        chatMessages.append(m)
        saveChat()
    }

    func trimChat(to max: Int) {
        guard chatMessages.count > max else { return }
        objectWillChange.send()
        chatMessages = Array(chatMessages.suffix(max))
        saveChat()
    }

    func clearChat() {
        guard !chatMessages.isEmpty else { return }
        objectWillChange.send()
        chatMessages.removeAll()
        saveChat()
    }

    // MARK: - AI 提议的资料变更

    /// 应用挂在某条聊天消息上的待确认变更
    @discardableResult
    func applyProposal(messageID: UUID) -> [String] {
        guard let idx = chatMessages.firstIndex(where: { $0.id == messageID }),
              let json = chatMessages[idx].proposal,
              let payload = Self.decodePayload(json) else { return [] }
        let changes = applyUpdate(payload)
        objectWillChange.send()
        chatMessages[idx].proposalResult = changes
        chatMessages[idx].proposalStatus = "applied"
        saveChat()
        return changes
    }

    func setProposalStatus(messageID: UUID, status: String) {
        guard let idx = chatMessages.firstIndex(where: { $0.id == messageID }) else { return }
        objectWillChange.send()
        chatMessages[idx].proposalStatus = status
        saveChat()
    }

    /// 把 AI 提议写进数据
    @discardableResult
    func applyUpdate(_ payload: AIUpdatePayload) -> [String] {
        let result = Self.plannedChanges(payload, in: data)
        guard !result.changes.isEmpty else { return [] }
        data = result.updated
        save()
        return result.changes
    }

    /// 纯函数版：逐字段白名单校验 + 范围夹紧，返回变更摘要与改好的数据副本。
    /// 聊天里的确认卡片用它做预览，点「应用」时走同一个函数，保证预览与落地一致。
    ///
    /// `now` 只影响「今日计划」变更挑哪一天的计划；默认取当前时间。
    static func plannedChanges(_ payload: AIUpdatePayload, in data: AppData, now: Date = Date())
        -> (changes: [String], updated: AppData) {
        var out = data
        var changes: [String] = []

        if let p = payload.profile {
            if let raw = p.sex, let v = normalizeSex(raw), v != out.profile.sex {
                changes.append("性别：\(sexLabel(out.profile.sex)) → \(sexLabel(v))")
                out.profile.sex = v
            }
            if let raw = p.age {
                let v = raw.clamped(to: 10...90)
                if v != out.profile.age {
                    changes.append("年龄：\(out.profile.age) → \(v)")
                    out.profile.age = v
                }
            }
            if let raw = p.heightCM {
                let v = (raw.clamped(to: 120...250) * 10).rounded() / 10
                if abs(v - out.profile.heightCM) > 0.05 {
                    changes.append("身高：\(fmt(out.profile.heightCM))cm → \(fmt(v))cm")
                    out.profile.heightCM = v
                }
            }
            if let raw = p.activityLevel, let v = snapActivityLevel(raw),
               abs(v - out.profile.activityLevel) > 0.001 {
                changes.append("活动系数：\(fmt(out.profile.activityLevel)) → \(fmt(v))")
                out.profile.activityLevel = v
            }
            if let raw = p.trainingDaysPerWeek {
                let v = raw.clamped(to: 1...7)
                if v != out.profile.trainingDaysPerWeek {
                    changes.append("每周训练天数：\(out.profile.trainingDaysPerWeek) → \(v)")
                    out.profile.trainingDaysPerWeek = v
                }
            }
        }

        if let g = payload.goal {
            if let raw = g.type, let v = normalizeGoalType(raw), v != out.goal.type {
                changes.append("目标类型：\(out.goal.type.label) → \(v.label)")
                out.goal.type = v
            }
            if let raw = g.targetWeightKG {
                let v = (raw.clamped(to: 30...200) * 10).rounded() / 10
                if abs(v - out.goal.targetWeightKG) > 0.05 {
                    changes.append("目标体重：\(fmt(out.goal.targetWeightKG))kg → \(fmt(v))kg")
                    out.goal.targetWeightKG = v
                }
            }
            if let raw = g.targetBodyFatPct {
                let v = (raw.clamped(to: 3...60) * 10).rounded() / 10
                if abs(v - (out.goal.targetBodyFatPct ?? -1)) > 0.05 {
                    let old = out.goal.targetBodyFatPct.map { "\(fmt($0))%" } ?? "未设置"
                    changes.append("目标体脂：\(old) → \(fmt(v))%")
                    out.goal.targetBodyFatPct = v
                }
            }
            if let raw = g.weeklyTargetDeltaKG {
                let v = (raw.clamped(to: 0...1) * 100).rounded() / 100
                if abs(v - out.goal.weeklyTargetDeltaKG) > 0.005 {
                    changes.append("每周增减：\(fmt2(out.goal.weeklyTargetDeltaKG))kg → \(fmt2(v))kg")
                    out.goal.weeklyTargetDeltaKG = v
                }
            }
        }

        if let b = payload.bigThree {
            var m = out.bigThree ?? BigThreeMax()
            func proposed(_ lift: BigThreeLift) -> Double? {
                switch lift {
                case .bench: return b.benchKG
                case .squat: return b.squatKG
                case .deadlift: return b.deadliftKG
                }
            }
            for lift in BigThreeLift.allCases {
                guard let raw = proposed(lift) else { continue }
                let v = StrengthModel.roundToPlate(raw.clamped(to: 20...400))
                if let old = lift.value(in: m), abs(old - v) < 0.01 { continue }
                let old = lift.value(in: m).map { "\(fmt($0))kg" } ?? "未设置"
                changes.append("\(lift.label)极限：\(old) → \(fmt(v))kg")
                lift.set(v, in: &m)
            }
            out.bigThree = m
        }

        if let incoming = payload.notes {
            var notes = out.coachNotes ?? []
            for raw in incoming {
                let note = String(raw.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
                guard !note.isEmpty, !notes.contains(note), notes.count < 12 else { continue }
                notes.append(note)
                changes.append("新增训练偏好：\(note)")
            }
            if !notes.isEmpty { out.coachNotes = notes }
        }

        // 今日计划变更：只有真的改到东西才替换数组
        if let plan = payload.plan {
            let r = applyPlanPatch(plan, in: out, now: now)
            if let workouts = r.workouts {
                out.plannedWorkouts = workouts
                changes.append(contentsOf: r.changes)
            }
        }

        return (changes, out)
    }

    // MARK: - 今日计划变更（AI 聊天用）

    /// 落地 AI 的今日计划变更，返回变更摘要与新的 plannedWorkouts（没改到东西时为 nil）。
    ///
    /// 只动「今天的、状态仍为 planned」的计划：已完成的计划改了也不会同步回训练历史，容易误导。
    /// patch.splitName 命中今天的某条计划名时改那条（用来在一天多条计划时点名），
    /// 没命中就是改名，落到今天的第一条计划上。
    private static func applyPlanPatch(_ patch: AIUpdatePayload.PlanPatch, in data: AppData, now: Date)
        -> (changes: [String], workouts: [PlannedWorkout]?) {
        let todays = data.plannedWorkouts.filter {
            $0.status == .planned && Calendar.current.isDate($0.date, inSameDayAs: now)
        }
        let named = patch.splitName.flatMap { raw in
            todays.first { $0.splitName == raw.trimmingCharacters(in: .whitespaces) }
        }
        guard let target = named ?? todays.first else { return ([], nil) }

        var changes: [String] = []
        var splitName = target.splitName
        if let raw = patch.splitName {
            let v = String(raw.trimmingCharacters(in: .whitespaces).prefix(30))
            if !v.isEmpty, v != splitName {
                changes.append("计划名称：\(splitName) → \(v)")
                splitName = v
            }
        }

        var exercises = target.exercises
        if let incoming = patch.exercises, !incoming.isEmpty {
            let next = planExercises(incoming, previous: target.exercises, data: data)
            if !next.isEmpty {
                changes.append(contentsOf: planDiff(previous: target.exercises, next: next))
                exercises = next
            }
        }

        guard !changes.isEmpty else { return ([], nil) }
        let workouts = data.plannedWorkouts.map { w -> PlannedWorkout in
            guard w.id == target.id else { return w }
            var copy = w
            copy.splitName = splitName
            copy.exercises = exercises
            return copy
        }
        return (changes, workouts)
    }

    /// 把 AI 给的动作列表补成可落地的 PlannedExercise：缺的组次/重量按旧值或配重链兜底
    private static func planExercises(_ incoming: [AIUpdatePayload.PlanPatch.ExercisePatch],
                                      previous: [PlannedExercise], data: AppData) -> [PlannedExercise] {
        let bodyWeight = data.bodyMetrics.sorted { $0.date < $1.date }.last?.weightKG ?? data.goal.targetWeightKG
        let prevByName = Dictionary(previous.map { ($0.name, $0) }, uniquingKeysWith: { a, _ in a })
        var out: [PlannedExercise] = []
        for raw in incoming {
            let name = (raw.name ?? "").trimmingCharacters(in: .whitespaces)
            guard !name.isEmpty else { continue }
            let prev = prevByName[name]
            let targetSets = (raw.targetSets ?? prev?.targetSets ?? 3).clamped(to: 1...10)
            let targetReps = (raw.targetReps ?? prev?.targetReps ?? 10).clamped(to: 1...30)
            let targetWeightKG: Double
            if CalorieEstimator.isBodyweight(name) {
                targetWeightKG = 0
            } else if let rawWeight = raw.targetWeightKG, rawWeight > 0 {
                targetWeightKG = StrengthModel.roundToPlate(rawWeight.clamped(to: 0...400))
            } else if let prev, prev.targetWeightKG > 0 {
                // 模型漏填重量：同名动作沿用原配重，新动作走配重优先级链
                targetWeightKG = prev.targetWeightKG
            } else {
                targetWeightKG = StrengthModel.prescribedWeight(for: name, reps: targetReps,
                                                               data: data, bodyWeightKG: bodyWeight)
            }
            out.append(PlannedExercise(id: prev?.id ?? UUID(), name: name,
                                       targetSets: targetSets, targetReps: targetReps,
                                       targetWeightKG: max(0, targetWeightKG)))
        }
        return out
    }

    /// 新旧动作列表的差异摘要：新增 / 移除 / 组次重量的变化
    private static func planDiff(previous: [PlannedExercise], next: [PlannedExercise]) -> [String] {
        var diff: [String] = []
        let prevByName = Dictionary(previous.map { ($0.name, $0) }, uniquingKeysWith: { a, _ in a })
        let nextNames = Set(next.map { $0.name })
        for e in next {
            guard let prev = prevByName[e.name] else {
                diff.append("新增动作：\(e.name) \(e.targetLabel)")
                continue
            }
            if prev.targetLabel != e.targetLabel {
                diff.append("\(e.name)：\(prev.targetLabel) → \(e.targetLabel)")
            }
        }
        for e in previous where !nextNames.contains(e.name) {
            diff.append("移除动作：\(e.name)")
        }
        return diff
    }

    static func decodePayload(_ json: String) -> AIUpdatePayload? {
        guard let d = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(AIUpdatePayload.self, from: d)
    }

    private static func normalizeSex(_ raw: String) -> String? {
        let s = raw.lowercased().trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("m") || s.hasPrefix("男") { return "male" }
        if s.hasPrefix("f") || s.hasPrefix("女") { return "female" }
        return nil
    }

    private static func sexLabel(_ s: String) -> String { s.lowercased().hasPrefix("f") ? "女" : "男" }

    private static func normalizeGoalType(_ raw: String) -> GoalType? {
        let s = raw.lowercased().trimmingCharacters(in: .whitespaces)
        if s.contains("bulk") || s.contains("增肌") { return .bulk }
        if s.contains("cut") || s.contains("减脂") || s.contains("减重") { return .cut }
        if s.contains("maintain") || s.contains("维持") || s.contains("保持") { return .maintain }
        return nil
    }

    /// 活动系数吸附到设置页提供的档位
    private static func snapActivityLevel(_ raw: Double) -> Double? {
        let levels = [1.2, 1.375, 1.55, 1.725, 1.9]
        guard let best = levels.min(by: { abs($0 - raw) < abs($1 - raw) }) else { return nil }
        return best
    }

    private static func fmt(_ v: Double) -> String {
        v == v.rounded() ? String(format: "%.0f", v) : String(format: "%.1f", v)
    }
    private static func fmt2(_ v: Double) -> String { String(format: "%.2f", v) }

    /// 追加计划；同日同拆分且仍待完成视为重复，返回是否写入
    @discardableResult
    func addPlannedWorkout(_ w: PlannedWorkout) -> Bool {
        let exists = data.plannedWorkouts.contains {
            Calendar.current.isDate($0.date, inSameDayAs: w.date)
                && $0.splitName == w.splitName && $0.status == .planned
        }
        guard !exists else { return false }
        data.plannedWorkouts.append(w)
        save()
        return true
    }

    /// 手动编辑计划（计划卡片上的「编辑」面板保存时调用）
    func updatePlannedWorkout(id: UUID, splitName: String, exercises: [PlannedExercise]) {
        guard let idx = data.plannedWorkouts.firstIndex(where: { $0.id == id }) else { return }
        data.plannedWorkouts[idx].splitName = splitName
        data.plannedWorkouts[idx].exercises = exercises
        save()
    }

    func clearWorkouts() {
        guard !data.workouts.isEmpty else { return }
        data.workouts.removeAll()
        save()
    }

    func deleteWorkout(id: UUID) {
        data.workouts.removeAll { $0.id == id }
        save()
    }

    func addDietLog(_ log: DietLog) {
        data.dietLogs.append(log)
        save()
    }

    func deleteDietLog(id: UUID) {
        data.dietLogs.removeAll { $0.id == id }
        save()
    }

    static func defaultFileURL() -> URL {
        let fm = FileManager.default
        let dir = (fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? fm.temporaryDirectory)
            .appendingPathComponent("FitTrack", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("fittrack.json")
    }

    static func load(from url: URL) -> AppData? {
        guard let d = try? Data(contentsOf: url) else { return nil }
        return decodeData(d)
    }

    private static func decodeData(_ raw: Data) -> AppData? {
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        return try? dec.decode(AppData.self, from: raw)
    }

    private static func encoder() -> JSONEncoder {
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        return enc
    }

    func save() {
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let d = try? enc.encode(data) {
            try? d.write(to: fileURL, options: .atomic)
        }
    }

    // MARK: - 查询辅助

    var latestWeight: Double? {
        data.bodyMetrics.sorted { $0.date < $1.date }.last?.weightKG
    }
    /// 估算卡路里与配重统一取这个体重：没有身体记录时退回目标体重
    var currentBodyWeightKG: Double { latestWeight ?? data.goal.targetWeightKG }
    var sortedMetrics: [BodyMetric] {
        data.bodyMetrics.sorted { $0.date < $1.date }
    }
    var sortedWorkouts: [WorkoutSession] {
        data.workouts.sorted { $0.date > $1.date }
    }

    func planned(on date: Date) -> [PlannedWorkout] {
        data.plannedWorkouts.filter { Calendar.current.isDate($0.date, inSameDayAs: date) }
    }

    /// 导出为 `AppData` 原样展开 + 一个 `chat` 键（聊天历史）。
    /// 保持 AppData 字段在顶层，旧导出文件与新文件都能被完整恢复流程读回。
    func exportJSON() throws -> String {
        let out = try Self.backupData(data: data, chat: chatMessages)
        guard let text = String(data: out, encoding: .utf8) else {
            throw CocoaError(.fileWriteInapplicableStringEncoding)
        }
        return text
    }

    @discardableResult
    func restore(_ candidate: RestoreCandidate) throws -> RestoreStats {
        let encoded = try Self.encoder().encode(candidate.data)
        guard let verified = Self.decodeData(encoded), verified.schemaVersion == AppData.currentSchemaVersion else {
            throw CocoaError(.fileReadCorruptFile)
        }
        _ = try JSONDecoder().decode([ChatMessage].self, from: JSONEncoder().encode(candidate.chat))

        let fm = FileManager.default
        let dataExisted = fm.fileExists(atPath: fileURL.path)
        let chatExisted = fm.fileExists(atPath: chatURL.path)
        let oldData = dataExisted ? try Data(contentsOf: fileURL) : nil
        let oldChat = chatExisted ? try Data(contentsOf: chatURL) : nil
        let backupDirectory = fileURL.deletingLastPathComponent().appendingPathComponent("Backups", isDirectory: true)
        try fm.createDirectory(at: backupDirectory, withIntermediateDirectories: true)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss-SSS"
        let snapshot = backupDirectory.appendingPathComponent("fittrack-\(formatter.string(from: Date())).json")
        try Self.backupData(data: data, chat: chatMessages).write(to: snapshot, options: .atomic)

        do {
            try encoded.write(to: fileURL, options: .atomic)
            try JSONEncoder().encode(candidate.chat).write(to: chatURL, options: .atomic)
        } catch {
            let writeError = error
            do {
                if let oldData { try oldData.write(to: fileURL, options: .atomic) }
                else if fm.fileExists(atPath: fileURL.path) { try fm.removeItem(at: fileURL) }
                if let oldChat { try oldChat.write(to: chatURL, options: .atomic) }
                else if fm.fileExists(atPath: chatURL.path) { try fm.removeItem(at: chatURL) }
            } catch {
                throw BackupRecoveryError.rollbackFailed("原始错误：\(writeError.localizedDescription)；回滚错误：\(error.localizedDescription)")
            }
            throw writeError
        }
        data = verified
        chatMessages = candidate.chat
        return candidate.stats
    }

    private static func backupData(data: AppData, chat: [ChatMessage]) throws -> Data {
        let enc = encoder()
        let raw = try enc.encode(data)
        guard var object = try JSONSerialization.jsonObject(with: raw) as? [String: Any] else {
            throw CocoaError(.fileWriteUnknown)
        }
        let chatRaw = try enc.encode(chat)
        object["chat"] = try JSONSerialization.jsonObject(with: chatRaw)
        return try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
    }

    /// 合并导入的聊天记录：按 id 去重后追加，返回新增条数
    @discardableResult
    func importChat(_ incoming: [ChatMessage]) -> Int {
        let existing = Set(chatMessages.map { $0.id })
        let fresh = incoming.filter { !existing.contains($0.id) }
        guard !fresh.isEmpty else { return 0 }
        objectWillChange.send()
        chatMessages.append(contentsOf: fresh)
        saveChat()
        return fresh.count
    }
}

extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}
