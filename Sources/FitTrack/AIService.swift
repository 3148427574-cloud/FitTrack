import Foundation
import Security

// MARK: - API Key 存储（Keychain 为主，UserDefaults 兜底）

enum AICredentials {
    private static let service = "com.frost.fittrack.ai"
    private static let account = "deepseek-api-key"
    private static let defaultsKey = "ai.deepseekKey"

    static func save(_ value: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        UserDefaults.standard.set(trimmed, forKey: defaultsKey)
        let data = Data(trimmed.utf8)
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(base as CFDictionary)
        var attrs = base
        attrs[kSecValueData as String] = data
        SecItemAdd(attrs as CFDictionary, nil)
    }

    static func load() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data, let s = String(data: data, encoding: .utf8) {
            return s
        }
        return UserDefaults.standard.string(forKey: defaultsKey)
    }

    static func delete() {
        UserDefaults.standard.removeObject(forKey: defaultsKey)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

// MARK: - AI 服务（DeepSeek Chat Completions API）

enum AIServiceError: LocalizedError {
    case missingKey
    case network(String)
    case parse(String)
    var errorDescription: String? {
        switch self {
        case .missingKey: return "未设置 API Key"
        case .network(let m): return "请求失败：\(m)"
        case .parse(let m): return "解析失败：\(m)"
        }
    }
}

final class AIService {
    static let endpoint = URL(string: "https://api.deepseek.com/chat/completions")!
    static let model = "deepseek-chat"

    // MARK: 基础请求

    private struct RequestBody: Encodable {
        struct Message: Encodable { let role: String; let content: String }
        let model: String
        let messages: [Message]
        let max_tokens: Int
        let stream: Bool
        let temperature: Double?
    }

    private struct ResponseBody: Decodable {
        struct Choice: Decodable {
            struct Message: Decodable { let content: String? }
            let message: Message
        }
        let choices: [Choice]
    }

    static func hasKey() -> Bool { !(AICredentials.load() ?? "").isEmpty }

    static func send(messages: [(role: String, content: String)], system: String, maxTokens: Int = 4000, temperature: Double? = nil) async throws -> String {
        guard let key = AICredentials.load(), !key.isEmpty else { throw AIServiceError.missingKey }
        var msgs: [RequestBody.Message] = []
        if !system.isEmpty { msgs.append(.init(role: "system", content: system)) }
        msgs.append(contentsOf: messages.map { .init(role: $0.role, content: $0.content) })
        let body = RequestBody(model: model, messages: msgs, max_tokens: maxTokens, stream: false, temperature: temperature)
        var req = URLRequest(url: endpoint)
        req.httpMethod = "POST"
        req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: req)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            let msg = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw AIServiceError.network("HTTP \(http.statusCode)：\(msg)")
        }
        let decoded = try JSONDecoder().decode(ResponseBody.self, from: data)
        guard let text = decoded.choices.first?.message.content, !text.isEmpty else {
            throw AIServiceError.parse("模型返回为空")
        }
        return text
    }

    // MARK: 上下文构建

    static func contextString(_ data: AppData) -> String {
        let p = data.profile
        var lines: [String] = []
        lines.append("性别 \(profileSex(p))，年龄 \(p.age)，身高 \(p.heightCM)cm，当前体重 \(latestWeightString(data))")
        lines.append("目标 \(data.goal.type.label)（目标体重 \(String(format: "%.1f", data.goal.targetWeightKG))kg，每周增减 \(String(format: "%.2f", data.goal.weeklyTargetDeltaKG))kg），每周训练 \(p.trainingDaysPerWeek) 天")
        lines.append("三大项极限：\(bigThreeSummary(data))")
        if let notes = data.coachNotes?.filter({ !$0.trimmingCharacters(in: .whitespaces).isEmpty }), !notes.isEmpty {
            lines.append("训练偏好与约束（用户长期设定，必须遵守）：\n" + notes.map { "- \($0)" }.joined(separator: "\n"))
        }
        lines.append("动作库：\(exerciseLibrary(data))")
        lines.append("身体数据趋势：\(bodySummary(data))")
        lines.append("最近训练记录：\n\(workoutSummary(data))")
        return lines.joined(separator: "\n")
    }

    /// 生效的三大项极限（手填优先，缺项用历史估算补齐）
    static func bigThreeSummary(_ data: AppData) -> String {
        let a = StrengthModel.anchors(data: data)
        let parts = BigThreeLift.allCases.compactMap { lift -> String? in
            guard let v = lift.value(in: a), v > 0 else { return nil }
            return "\(lift.label) \(String(format: "%.0f", v))kg"
        }
        return parts.isEmpty ? "未录入（辅项按体重比例保守估算）" : parts.joined(separator: "，")
    }

    private static func profileSex(_ p: UserProfile) -> String {
        p.sex.lowercased().hasPrefix("f") ? "女" : "男"
    }

    private static func latestWeightString(_ data: AppData) -> String {
        if let w = data.bodyMetrics.sorted(by: { $0.date < $1.date }).last?.weightKG {
            return String(format: "%.1fkg", w)
        }
        return String(format: "%.1fkg", data.goal.targetWeightKG)
    }

    private static func latestWeightKG(_ data: AppData) -> Double {
        data.bodyMetrics.sorted(by: { $0.date < $1.date }).last?.weightKG ?? data.goal.targetWeightKG
    }

    private static func exerciseLibrary(_ data: AppData) -> String {
        data.exercises.map { "\($0.name)(\($0.muscleGroup))" }.joined(separator: "、")
    }

    private static func bodySummary(_ data: AppData) -> String {
        let metrics = data.bodyMetrics.sorted { $0.date < $1.date }
        guard let first = metrics.first, let last = metrics.last else { return "无身体数据" }
        let days = Calendar.current.dateComponents([.day], from: first.date, to: last.date).day ?? 0
        let delta = last.weightKG - first.weightKG
        var parts = ["共 \(metrics.count) 条，最近 \(String(format: "%.1f", last.weightKG))kg（\(last.date.formatted(date: .numeric, time: .omitted))）"]
        if days > 0 {
            parts.append("较 \(days) 天前首条 \(String(format: "%.1f", first.weightKG))kg 变化 \(delta >= 0 ? "+" : "")\(String(format: "%.1f", delta))kg")
        }
        if let bf = last.bodyFatPct { parts.append("体脂 \(String(format: "%.1f", bf))%") }
        return parts.joined(separator: "，")
    }

    private static func workoutSummary(_ data: AppData) -> String {
        let recent = data.workouts.sorted { $0.date > $1.date }.prefix(20)
        guard !recent.isEmpty else { return "无训练历史" }
        return recent.map { w in
            let exs = w.exercises.map { ex in
                let best = ex.sets.map { "\($0.weightKG)kg×\($0.reps)" }.joined(separator: ",")
                return "\(ex.name)(\(best))"
            }.joined(separator: "；")
            return "\(w.date.formatted(date: .numeric, time: .omitted)) [\(w.splitName)] \(exs)"
        }.joined(separator: "\n")
    }

    // MARK: 训练计划生成

    private struct AIExercise: Codable { let name: String; let targetSets: Int; let targetReps: Int; let targetWeightKG: Double }
    private struct AIWorkoutPlan: Codable { let splitName: String; let reason: String; let exercises: [AIExercise] }

    static func generatePlan(data: AppData, date: Date) async throws -> PlannedWorkout {
        let weekday = Calendar.current.component(.weekday, from: date)
        let weekdayName = ["", "周日", "周一", "周二", "周三", "周四", "周五", "周六"][weekday]

        let system = """
        你是一名专业的增肌健身教练。根据用户的训练历史与身体数据变化，为「今天（\(weekdayName)）」生成一份训练计划。
        要求：
        1. 目标重量 = 该动作 1RM × 目标次数对应强度（约 6 次 83%、8 次 79%、10 次 75%、12 次 71%、15 次 67%），四舍五入到 2.5kg 的整数倍。
        1RM 优先取该动作自己的历史记录；该动作没有历史数据时，用用户数据里的「三大项极限」按发力模式换算（推类看卧推、蹲类看深蹲、髋铰链看硬拉），再乘以次数强度。
        自重动作（如引体向上）targetWeightKG 填 0；无论有无历史数据都不要填 0 或留空。
        2. 用户数据里的「训练偏好与约束」是用户的长期设定，必须遵守。
        3. 大肌群 48h 恢复：参考最近训练记录，避开近两天已充分刺激的部位。
        4. 结合身体趋势与目标（增肌/减脂/维持）微调容量与强度。
        5. 动作名称必须从用户动作库中选取，允许用同肌群的库内动作替换。
        6. 只输出一个 JSON 对象，不要输出任何其他文字、解释或 markdown 代码块标记，严格遵循此格式：
        {"splitName":"胸","reason":"一句话说明安排依据","exercises":[{"name":"杠铃卧推","targetSets":4,"targetReps":8,"targetWeightKG":62.5}]}
        """

        let text = try await send(messages: [(role: "user", content: contextString(data))], system: system, maxTokens: 4000, temperature: 0.3)
        guard let plan = parsePlan(from: text, date: date, data: data) else {
            throw AIServiceError.parse("无法解析计划 JSON")
        }
        return plan
    }

    /// AI 生成失败或未配置 Key 时回退到固定模板
    static func generatePlanWithFallback(data: AppData, date: Date) async -> PlannedWorkout {
        if hasKey(), let p = try? await generatePlan(data: data, date: date) {
            return p
        }
        return TrainingPlanner.generatePlan(date: date, data: data)
    }

    private static func parsePlan(from text: String, date: Date, data: AppData) -> PlannedWorkout? {
        var s = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let start = s.firstIndex(of: "{"), let end = s.lastIndex(of: "}"), start <= end {
            s = String(s[start...end])
        }
        guard let jsonData = s.data(using: .utf8),
              let ai = try? JSONDecoder().decode(AIWorkoutPlan.self, from: jsonData) else { return nil }
        let bodyWeight = latestWeightKG(data)
        let exercises = ai.exercises.map { ex -> PlannedExercise in
            var weight = ex.targetWeightKG
            // 模型漏填重量时，本地按同一套优先级链补一个
            if weight <= 0 && !CalorieEstimator.isBodyweight(ex.name) {
                weight = StrengthModel.prescribedWeight(for: ex.name, reps: ex.targetReps,
                                                       data: data, bodyWeightKG: bodyWeight)
            }
            return PlannedExercise(name: ex.name, targetSets: ex.targetSets,
                                   targetReps: ex.targetReps, targetWeightKG: weight)
        }
        return PlannedWorkout(date: date, splitName: ai.splitName, exercises: exercises, note: ai.reason)
    }

    // MARK: 聊天

    /// 资料变更提议的哨兵标记
    static let updateOpen = "<<<UPDATES>>>"
    static let updateClose = "<<<END>>>"

    struct ChatReply {
        var text: String
        /// 待用户确认的资料变更（原始 JSON），nil 表示这条回复没有提议
        var proposalJSON: String?
    }

    /// 让模型用哨兵块提出资料变更；App 收到后渲染成待确认卡片，用户点「应用」才写入
    private static let updateProtocol = """
    你可以在用户表达了长期的目标、身体数据或训练条件变化时，提出资料更新建议。
    只在下列情况提议，其余情况一律只回答、不提议：
    - 用户明确了训练目标（增肌/减脂/维持）、目标体重或每周增减速度
    - 用户说明了自己的长期约束或偏好（例如每周只能练几天、某个动作做不了、偏好低次数力量训练）
    - 用户提供了新的身高/年龄/性别/活动量/三大项极限重量

    提议写法：在回复正文之后另起一行，输出下面这一整块。尖括号原样保留，不要用代码块包裹，这一块之后不要再写任何内容：
    \(updateOpen){"profile":{"age":30,"heightCM":180,"trainingDaysPerWeek":5,"sex":"male","activityLevel":1.55},"goal":{"type":"bulk","targetWeightKG":78,"targetBodyFatPct":15,"weeklyTargetDeltaKG":0.3},"bigThree":{"benchKG":80,"squatKG":110,"deadliftKG":140},"notes":["偏好低次数力量训练，主项做 5x5"],"reason":"一句话说明建议这样改的理由"}\(updateClose)

    字段说明：
    - 只写需要改的字段，其余省略；上面所有字段都可以省略。
    - goal.type 只能取 bulk / cut / maintain；sex 只能取 male / female。
    - notes 会长期注入你的上下文，写用户的长期偏好或约束，每条一句话；已有的偏好不要重复提出。
    - 不需要改任何资料时，完全不输出这一块。
    """

    static func chat(history: [(role: String, content: String)], context: String) async throws -> ChatReply {
        let system = """
        你是一名专业的健身与营养教练，帮助用户进行增肌/减脂训练。你可以解答动作替换、动作规范、训练计划调整、饮食营养等问题。
        请结合下方用户真实数据给出个性化、简洁实用的建议，用简体中文回答。

        当前用户数据：
        \(context)

        \(updateProtocol)
        """
        return splitProposal(try await send(messages: history, system: system, maxTokens: 8000))
    }

    /// 拆出正文与资料变更提案；提案解不出或没有任何实际改动时丢弃，不让坏卡片污染聊天
    static func splitProposal(_ raw: String) -> ChatReply {
        guard let open = raw.range(of: updateOpen),
              let close = raw.range(of: updateClose, range: open.upperBound..<raw.endIndex) else {
            return ChatReply(text: raw.trimmingCharacters(in: .whitespacesAndNewlines), proposalJSON: nil)
        }
        let json = String(raw[open.upperBound..<close.lowerBound])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        var text = raw
        text.removeSubrange(open.lowerBound..<close.upperBound)
        text = stripTrailingFences(text)

        guard let d = json.data(using: .utf8),
              let payload = try? JSONDecoder().decode(AIUpdatePayload.self, from: d),
              payload.hasAnyChange else {
            return ChatReply(text: text, proposalJSON: nil)
        }
        return ChatReply(text: text, proposalJSON: json)
    }

    /// 模型偶尔用 ``` 包裹哨兵块，剥掉正文末尾残留的围栏行
    private static func stripTrailingFences(_ s: String) -> String {
        var lines = s.components(separatedBy: .newlines)
        while let last = lines.last {
            let t = last.trimmingCharacters(in: .whitespaces).lowercased()
            if t.isEmpty || t == "```" || t == "```json" { lines.removeLast() } else { break }
        }
        return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
