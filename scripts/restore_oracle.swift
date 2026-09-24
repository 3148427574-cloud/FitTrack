import Foundation

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else {
        FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
        exit(1)
    }
}

@main
struct RestoreOracle {
    static func main() throws {
        let workoutID = "11111111-1111-1111-1111-111111111111"
        let plannedID = "22222222-2222-2222-2222-222222222222"
        let exerciseID = "33333333-3333-3333-3333-333333333333"
        let complete = """
        {
          "schemaVersion": 2,
          "createdAt": "2026-09-20T12:00:00Z",
          "updatedAt": "2026-09-21T12:00:00Z",
          "profile": {"sex":"female","age":30,"heightCM":165,"activityLevel":1.55,"trainingDaysPerWeek":4},
          "goal": {"type":"maintain","targetWeightKG":60,"weeklyTargetDeltaKG":0.1},
          "workouts": [{"id":"\(workoutID)","date":"2026-09-20T12:00:00Z","splitName":"推","exercises":[],"durationMin":45}],
          "plannedWorkouts": [{"id":"\(plannedID)","date":"2026-09-22T12:00:00Z","splitName":"拉","exercises":[]}],
          "bodyMetrics": [], "foods": [],
          "exercises": [{"id":"\(exerciseID)","name":"旧动作","muscleGroup":"背","equipment":"自重"}],
          "dietLogs": [], "chat": []
        }
        """

        let parsed = try BackupRecovery.parse(complete)
        require(parsed.canApply, "完整备份应可恢复")
        require(parsed.data.createdAt != nil && parsed.data.updatedAt != nil, "Date 字符串标量应保留")
        require(parsed.data.workouts.first?.notes == "", "旧 WorkoutSession 缺 notes 使用默认值")
        require(parsed.data.plannedWorkouts.first?.status == .planned, "旧 PlannedWorkout 缺 status 使用默认值")
        require(parsed.data.exercises.first?.isBodyweight == false, "旧 ExerciseDef 缺 isBodyweight 使用默认值")
        require(parsed.data.foods.isEmpty, "显式空集合保持为空")

        for token in ["true", "1.5", "0", "-1"] {
            let invalid = complete.replacingOccurrences(of: "\"schemaVersion\": 2", with: "\"schemaVersion\": \(token)")
            let invalidPreview = try BackupRecovery.parse(invalid)
            require(!invalidPreview.canApply, "非法 schemaVersion \(token) 必须阻断")
        }
        let future = try BackupRecovery.parse(complete.replacingOccurrences(of: "\"schemaVersion\": 2", with: "\"schemaVersion\": 999"))
        require(!future.canApply, "未来版本必须阻断")

        let missingCritical = try BackupRecovery.parse(complete.replacingOccurrences(of: "\n  \"profile\": {\"sex\":\"female\",\"age\":30,\"heightCM\":165,\"activityLevel\":1.55,\"trainingDaysPerWeek\":4},", with: ""))
        require(!missingCritical.canApply, "缺 profile 必须阻断")

        let minimal = try BackupRecovery.parse("{\"profile\":{\"sex\":\"male\",\"age\":25,\"heightCM\":175,\"activityLevel\":1.55,\"trainingDaysPerWeek\":4},\"goal\":{\"type\":\"bulk\",\"targetWeightKG\":75,\"weeklyTargetDeltaKG\":0.25}}")
        require(minimal.canApply && minimal.data.workouts.isEmpty, "缺普通集合按空数组")
        require(!minimal.data.foods.isEmpty && !minimal.data.exercises.isEmpty, "缺 foods/exercises 使用 seed")

        let nonArray = try BackupRecovery.parse(complete.replacingOccurrences(of: "\"bodyMetrics\": []", with: "\"bodyMetrics\": {}"))
        require(!nonArray.canApply, "非数组集合必须阻断")

        let negative = try BackupRecovery.parse(complete.replacingOccurrences(of: "\"durationMin\":45", with: "\"durationMin\":-1"))
        require(negative.skipped == 1 && negative.data.workouts.isEmpty, "负训练数值条目必须跳过")
        let duplicateWorkoutExercises = try BackupRecovery.parse(complete.replacingOccurrences(
            of: "\"exercises\":[],\"durationMin\":45",
            with: "\"exercises\":[{\"id\":\"AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA\",\"name\":\"卧推\",\"sets\":[]},{\"id\":\"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\",\"name\":\"卧推\",\"sets\":[]}],\"durationMin\":45"
        ))
        require(duplicateWorkoutExercises.skipped == 1 && duplicateWorkoutExercises.data.workouts.isEmpty,
                "WorkoutSession 嵌套动作 UUID 重复时必须跳过整条训练")
        let duplicatePlannedExercises = try BackupRecovery.parse(complete.replacingOccurrences(
            of: "\"splitName\":\"拉\",\"exercises\":[]",
            with: "\"splitName\":\"拉\",\"exercises\":[{\"id\":\"BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB\",\"name\":\"划船\",\"targetSets\":3,\"targetReps\":8,\"targetWeightKG\":40},{\"id\":\"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb\",\"name\":\"划船\",\"targetSets\":3,\"targetReps\":8,\"targetWeightKG\":40}]"
        ))
        require(duplicatePlannedExercises.skipped == 1 && duplicatePlannedExercises.data.plannedWorkouts.isEmpty,
                "PlannedWorkout 嵌套动作 UUID 重复时必须跳过整条计划")
        let negativeProfile = try BackupRecovery.parse(complete.replacingOccurrences(of: "\"age\":30", with: "\"age\":-1"))
        require(!negativeProfile.canApply, "负 profile 数值必须阻断")

        let replaced = try BackupRecovery.candidate(from: parsed, local: AppData(), localChat: [], mode: .replace, policy: .backup)
        require(replaced.data.createdAt == parsed.data.createdAt && replaced.data.updatedAt == parsed.data.updatedAt,
                "replace 必须保留备份时间戳")

        var local = AppData()
        let localCreated = ISO8601DateFormatter().date(from: "2025-01-01T00:00:00Z")!
        local.createdAt = localCreated
        local.updatedAt = ISO8601DateFormatter().date(from: "2025-01-02T00:00:00Z")!
        let duplicate = parsed.data.workouts[0]
        local.workouts = [duplicate, duplicate]
        let merged = try BackupRecovery.candidate(from: parsed, local: local, localChat: [], mode: .merge, policy: .backup)
        require(merged.data.workouts.count == 1 && merged.stats.ignored >= 2, "本地重复 ID 保留第一条并计 ignored")
        require(merged.data.createdAt == localCreated && merged.data.updatedAt == parsed.data.updatedAt,
                "merge 时间戳规则")

        print("restore oracle passed: schema, dates, missing fields, arrays, validation, legacy defaults, parent and nested duplicates, timestamps")
    }
}
