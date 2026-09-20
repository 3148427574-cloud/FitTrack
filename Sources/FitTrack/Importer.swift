import Foundation

// MARK: - 导入 Schema（对外统一契约）

struct ImportWorkout: Codable {
    var date: String
    var split: String?
    var durationMin: Double?
    var exercises: [ImportExercise]?
}

struct ImportExercise: Codable {
    var name: String
    var sets: [ImportSet]
    var rpe: Double?
}

struct ImportSet: Codable {
    var reps: Int
    var weight_kg: Double

    enum CodingKeys: String, CodingKey { case reps, weight_kg, weightKG }

    /// 同时接受 `weight_kg`（对外 schema）和 `weightKG`（App 自己的导出格式）。
    /// 「导出 JSON」写的是 AppData，字段名是驼峰，不兼容的话导出的备份根本导不回来。
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        reps = (try? c.decodeIfPresent(Int.self, forKey: .reps)) ?? 0
        if let v = try c.decodeIfPresent(Double.self, forKey: .weight_kg) {
            weight_kg = v
        } else if let v = try c.decodeIfPresent(Double.self, forKey: .weightKG) {
            weight_kg = v
        } else {
            throw DecodingError.keyNotFound(CodingKeys.weight_kg, .init(
                codingPath: c.codingPath,
                debugDescription: "缺少 weight_kg（或 weightKG）"))
        }
    }

    init(reps: Int, weight_kg: Double) {
        self.reps = reps
        self.weight_kg = weight_kg
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(reps, forKey: .reps)
        try c.encode(weight_kg, forKey: .weight_kg)
    }
}

struct ImportBodyMetric: Codable {
    var date: String
    var weight_kg: Double
    var bodyFatPct: Double?
    var muscleMassKG: Double?
    var waistCM: Double?
    var chestCM: Double?
    var armCM: Double?
    var thighCM: Double?

    enum CodingKeys: String, CodingKey {
        case date, weight_kg, weightKG, bodyFatPct, muscleMassKG
        case waistCM, chestCM, armCM, thighCM
    }

    /// 与 ImportSet 同理：兼容 App 自己导出的 `weightKG`
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = try c.decode(String.self, forKey: .date)
        if let v = try c.decodeIfPresent(Double.self, forKey: .weight_kg) {
            weight_kg = v
        } else if let v = try c.decodeIfPresent(Double.self, forKey: .weightKG) {
            weight_kg = v
        } else {
            throw DecodingError.keyNotFound(CodingKeys.weight_kg, .init(
                codingPath: c.codingPath,
                debugDescription: "缺少 weight_kg（或 weightKG）"))
        }
        bodyFatPct = try c.decodeIfPresent(Double.self, forKey: .bodyFatPct)
        muscleMassKG = try c.decodeIfPresent(Double.self, forKey: .muscleMassKG)
        waistCM = try c.decodeIfPresent(Double.self, forKey: .waistCM)
        chestCM = try c.decodeIfPresent(Double.self, forKey: .chestCM)
        armCM = try c.decodeIfPresent(Double.self, forKey: .armCM)
        thighCM = try c.decodeIfPresent(Double.self, forKey: .thighCM)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(date, forKey: .date)
        try c.encode(weight_kg, forKey: .weight_kg)
        try c.encodeIfPresent(bodyFatPct, forKey: .bodyFatPct)
        try c.encodeIfPresent(muscleMassKG, forKey: .muscleMassKG)
        try c.encodeIfPresent(waistCM, forKey: .waistCM)
        try c.encodeIfPresent(chestCM, forKey: .chestCM)
        try c.encodeIfPresent(armCM, forKey: .armCM)
        try c.encodeIfPresent(thighCM, forKey: .thighCM)
    }
}

struct ImportSchema: Codable {
    var version: String?
    var source: String?
    var workouts: [ImportWorkout]?
    var bodyMetrics: [ImportBodyMetric]?
    /// 导出文件里附带的聊天历史；非必填，缺了就跳过
    var chat: [ChatMessage]?
}

struct ImportResult {
    var workouts = 0
    var metrics = 0
    var chat: [ChatMessage] = []
    var message = ""
}

// MARK: - 日期解析

enum DateParse {
    static func parse(_ s: String) -> Date? {
        let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
        let iso = ISO8601DateFormatter()
        if let d = iso.date(from: trimmed) { return d }
        let fmts = ["yyyy-MM-dd", "yyyy/MM/dd", "yyyy-MM-dd HH:mm:ss", "yyyy/MM/dd HH:mm:ss"]
        for f in fmts {
            let df = DateFormatter()
            df.dateFormat = f
            df.locale = Locale(identifier: "en_US_POSIX")
            if let d = df.date(from: trimmed) { return d }
        }
        return nil
    }
}

// MARK: - CSV 解析

enum CSVParser {
    static func parse(_ text: String) -> [[String]] {
        let delimiter: Character = text.contains("\t") ? "\t" : (text.contains(";") ? ";" : ",")
        var rows: [[String]] = []
        var row: [String] = []
        var field = ""
        var inQuotes = false
        var idx = text.startIndex
        while idx < text.endIndex {
            let c = text[idx]
            if inQuotes {
                if c == "\"" {
                    let next = text.index(after: idx)
                    if next < text.endIndex && text[next] == "\"" {
                        field.append("\"")
                        idx = next
                    } else {
                        inQuotes = false
                    }
                } else {
                    field.append(c)
                }
            } else {
                if c == "\"" {
                    inQuotes = true
                } else if c == delimiter {
                    row.append(field); field = ""
                } else if c == "\n" || c == "\r" {
                    let next = text.index(after: idx)
                    if c == "\r", next < text.endIndex, text[next] == "\n" { idx = next }
                    row.append(field); field = ""
                    rows.append(row); row = []
                } else {
                    field.append(c)
                }
            }
            idx = text.index(after: idx)
        }
        if !field.isEmpty || !row.isEmpty { row.append(field); rows.append(row) }
        return rows.filter { !$0.allSatisfy { $0.trimmingCharacters(in: .whitespaces).isEmpty } }
    }
}

// MARK: - 导入器

enum Importer {
    static func importJSON(_ text: String, into data: inout AppData) -> ImportResult {
        var result = ImportResult()
        let dec = JSONDecoder()
        guard let d = text.data(using: .utf8),
              let schema = try? dec.decode(ImportSchema.self, from: d) else {
            result.message = "JSON 解析失败：请检查格式是否符合 schema"
            return result
        }
        for w in schema.workouts ?? [] {
            guard let date = DateParse.parse(w.date) else { continue }
            let exercises = (w.exercises ?? []).map { ex -> ExerciseEntry in
                ExerciseEntry(name: ex.name,
                              sets: ex.sets.map { SetEntry(reps: $0.reps, weightKG: $0.weight_kg) },
                              rpe: ex.rpe)
            }
            data.workouts.append(WorkoutSession(date: date, splitName: w.split ?? "导入",
                                                exercises: exercises, durationMin: w.durationMin ?? 0))
            result.workouts += 1
        }
        for m in schema.bodyMetrics ?? [] {
            guard let date = DateParse.parse(m.date) else { continue }
            data.bodyMetrics.append(BodyMetric(date: date, weightKG: m.weight_kg,
                                               bodyFatPct: m.bodyFatPct, muscleMassKG: m.muscleMassKG,
                                               waistCM: m.waistCM, chestCM: m.chestCM, armCM: m.armCM,
                                               thighCM: m.thighCM))
            result.metrics += 1
        }
        result.chat = schema.chat ?? []
        result.message = "导入完成：训练 \(result.workouts) 条，身体数据 \(result.metrics) 条"
        return result
    }

    /// 自动识别 CSV 是「身体数据」还是「训练记录」
    static func importCSV(_ text: String, into data: inout AppData) -> ImportResult {
        var result = ImportResult()
        let rows = CSVParser.parse(text)
        guard let header = rows.first else {
            result.message = "CSV 为空"
            return result
        }
        let lower = header.map { $0.lowercased().trimmingCharacters(in: .whitespaces) }
        func col(_ name: String) -> Int? { lower.firstIndex(of: name) }

        if lower.contains("weight_kg") || lower.contains("weightkg") || lower.contains("体重") {
            let dateIdx = col("date") ?? col("日期") ?? 0
            let weightIdx = col("weight_kg") ?? col("weightkg") ?? col("体重") ?? 1
            let fatIdx = col("bodyfatpct") ?? col("body_fat_pct") ?? col("体脂")
            let waistIdx = col("waist_cm") ?? col("腰围")
            for r in rows.dropFirst() {
                guard r.count > max(dateIdx, weightIdx),
                      let date = DateParse.parse(r[dateIdx]),
                      let w = Double(r[weightIdx]) else { continue }
                data.bodyMetrics.append(BodyMetric(date: date, weightKG: w,
                                                   bodyFatPct: fatIdx.flatMap { r.count > $0 ? Double(r[$0]) : nil },
                                                   waistCM: waistIdx.flatMap { r.count > $0 ? Double(r[$0]) : nil }))
                result.metrics += 1
            }
        } else if lower.contains("exercise") || lower.contains("动作") {
            let dateIdx = col("date") ?? col("日期") ?? 0
            let exIdx = col("exercise") ?? col("动作") ?? 1
            let repsIdx = col("reps") ?? col("次数") ?? 2
            let weightIdx = col("weight_kg") ?? col("重量") ?? 3
            var byDate: [String: [ExerciseEntry]] = [:]
            var order: [String] = []
            for r in rows.dropFirst() {
                guard r.count > max(dateIdx, exIdx, repsIdx),
                      DateParse.parse(r[dateIdx]) != nil else { continue }
                let reps = Int(r[repsIdx]) ?? 0
                let weight = weightIdx < r.count ? (Double(r[weightIdx]) ?? 0) : 0
                let key = r[dateIdx]
                var entry = ExerciseEntry(name: r[exIdx], sets: [SetEntry(reps: reps, weightKG: weight)])
                if var existing = byDate[key]?.first(where: { $0.name == r[exIdx] }) {
                    existing.sets.append(SetEntry(reps: reps, weightKG: weight))
                    entry = existing
                }
                byDate[key, default: []].removeAll { $0.name == r[exIdx] }
                byDate[key, default: []].append(entry)
                if !order.contains(key) { order.append(key) }
            }
            for key in order {
                let date = DateParse.parse(key) ?? Date()
                data.workouts.append(WorkoutSession(date: date, splitName: "导入",
                                                    exercises: byDate[key] ?? [], durationMin: 0))
                result.workouts += 1
            }
        } else {
            result.message = "无法识别 CSV 类型：请包含 weight_kg（身体数据）或 exercise（训练记录）列"
            return result
        }
        result.message = "导入完成：训练 \(result.workouts) 条，身体数据 \(result.metrics) 条"
        return result
    }
}
