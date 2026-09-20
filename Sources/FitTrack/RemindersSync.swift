import Foundation
import EventKit

/// 同步到「提醒事项」/ 导出 .ics 时的文案。口径必须与 App 内 PlanCard 一致，
/// 否则同一次训练在手机提醒里和 App 里显示的重量、卡路里会对不上。
enum WorkoutText {
    static func weightLabel(_ ex: PlannedExercise) -> String {
        if CalorieEstimator.isBodyweight(ex.name) { return "自重" }
        return ex.targetWeightKG > 0 ? String(format: "%.1fkg", ex.targetWeightKG) : "待定"
    }

    static func exerciseLine(_ ex: PlannedExercise, bodyWeightKG: Double, heightCM: Double) -> String {
        let kcal = CalorieEstimator.calories(for: ex, bodyWeightKG: bodyWeightKG, heightCM: heightCM)
        return "\(ex.name) \(ex.targetSets)x\(ex.targetReps) \(weightLabel(ex)) · \(String(format: "%.0f千卡", kcal))"
    }

    static func exerciseLines(_ w: PlannedWorkout, bodyWeightKG: Double, heightCM: Double) -> [String] {
        w.exercises.map { exerciseLine($0, bodyWeightKG: bodyWeightKG, heightCM: heightCM) }
    }

    /// 合计行。身高行程修正只在明显偏离 1 时才写出来，免得提醒里全是噪声。
    static func totalLine(_ w: PlannedWorkout, bodyWeightKG: Double, heightCM: Double) -> String? {
        let total = CalorieEstimator.total(workout: w, bodyWeightKG: bodyWeightKG, heightCM: heightCM)
        guard total > 0 else { return nil }
        let base = CalorieEstimator.baseTotal(workout: w, bodyWeightKG: bodyWeightKG)
        let factor = base > 0 ? total / base : 1
        guard abs(factor - 1) >= 0.005 else {
            return String(format: "预计消耗 %.0f 千卡", total)
        }
        return String(format: "预计消耗 %.0f 千卡（身高 %.0fcm 行程修正 ×%.2f）", total, heightCM, factor)
    }

    static func note(for w: PlannedWorkout, bodyWeightKG: Double, heightCM: Double) -> String {
        var lines = exerciseLines(w, bodyWeightKG: bodyWeightKG, heightCM: heightCM)
        if let t = totalLine(w, bodyWeightKG: bodyWeightKG, heightCM: heightCM) { lines.append(t) }
        return lines.joined(separator: "\n")
    }
}

/// 用 EventKit 与 Apple「提醒事项」双向同步训练计划。
/// 关联通过 `PlannedWorkout.reminderID`（即 EKReminder.calendarItemIdentifier）建立。
@MainActor
enum RemindersSync {
    static let store = EKEventStore()

    // MARK: 权限

    static func ensureAccess() async throws -> Bool {
        switch EKEventStore.authorizationStatus(for: .reminder) {
        case .fullAccess: return true
        case .notDetermined: return try await store.requestFullAccessToReminders()
        default: return false
        }
    }

    // MARK: 创建提醒 → 返回 [计划ID: 提醒identifier]

    static func syncToReminders(workouts: [PlannedWorkout],
                                bodyWeightKG: Double,
                                heightCM: Double) async -> Result<[UUID: String], Error> {
        do {
            guard try await ensureAccess() else {
                throw NSError(domain: "FitTrack", code: -1,
                              userInfo: [NSLocalizedDescriptionKey: "未授予「提醒事项」权限"])
            }
            var links: [UUID: String] = [:]
            let calendar = store.defaultCalendarForNewReminders()
            for w in workouts {
                let reminder = EKReminder(eventStore: store)
                reminder.title = "🏋️ 训练：\(w.splitName)"
                reminder.notes = WorkoutText.note(for: w, bodyWeightKG: bodyWeightKG, heightCM: heightCM)
                reminder.calendar = calendar
                reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day], from: w.date)
                try store.save(reminder, commit: true)
                links[w.id] = reminder.calendarItemIdentifier
            }
            return .success(links)
        } catch {
            return .failure(error)
        }
    }

    // MARK: 完成 / 删除（App 内操作 → 推送回提醒事项）

    static func markCompleted(reminderID: String) async {
        guard let item = store.calendarItem(withIdentifier: reminderID),
              let reminder = item as? EKReminder else { return }
        reminder.isCompleted = true
        try? store.save(reminder, commit: true)
    }

    static func markDeleted(reminderID: String) async {
        guard let item = store.calendarItem(withIdentifier: reminderID),
              let reminder = item as? EKReminder else { return }
        try? store.remove(reminder, commit: true)
    }

    // MARK: 读取完成状态（提醒事项 → 拉回 App）

    static func fetchStatus(ids: [String]) async -> [String: Bool] {
        guard (try? await ensureAccess()) == true else { return [:] }
        var result: [String: Bool] = [:]
        for id in ids {
            if let item = store.calendarItem(withIdentifier: id),
               let reminder = item as? EKReminder {
                result[id] = reminder.isCompleted
            }
        }
        return result
    }
}

enum ICSExporter {
    /// 生成 iCalendar(.ics) 文本，可导入 Apple 日历（无签名时也能用）
    static func ics(for workouts: [PlannedWorkout], bodyWeightKG: Double, heightCM: Double) -> String {
        var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FitTrack//Training//CN", "CALSCALE:GREGORIAN"]
        let df = DateFormatter()
        df.dateFormat = "yyyyMMdd"
        df.timeZone = TimeZone.current
        for w in workouts {
            lines.append("BEGIN:VEVENT")
            lines.append("UID:\(w.id.uuidString)@fittrack")
            lines.append("DTSTART;VALUE=DATE:\(df.string(from: w.date))")
            lines.append("SUMMARY:🏋️ 训练：\(w.splitName)")
            var parts = WorkoutText.exerciseLines(w, bodyWeightKG: bodyWeightKG, heightCM: heightCM)
            if let t = WorkoutText.totalLine(w, bodyWeightKG: bodyWeightKG, heightCM: heightCM) { parts.append(t) }
            let desc = parts.joined(separator: ", ")
            lines.append("DESCRIPTION:\(desc)")
            lines.append("END:VEVENT")
        }
        lines.append("END:VCALENDAR")
        return lines.joined(separator: "\r\n")
    }
}
