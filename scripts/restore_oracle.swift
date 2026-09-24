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

        require(parsed.data.dietCalibration.currentAdjustmentKcal == 0
                    && parsed.data.dietCalibration.evaluations.isEmpty,
                "v1/v2 缺校准字段时使用 0 和空历史")
        let evaluationID = "44444444-4444-4444-4444-444444444444"
        let calibrated = complete.replacingOccurrences(
            of: "\"dietLogs\": [], \"chat\": []",
            with: "\"dietLogs\": [], \"dietCalibration\":{\"currentAdjustmentKcal\":100,\"evaluations\":[{\"id\":\"\(evaluationID)\",\"earliestWindowStart\":\"2026-09-01\",\"earliestWindowEnd\":\"2026-09-07\",\"latestWindowStart\":\"2026-09-08\",\"latestWindowEnd\":\"2026-09-14\",\"earliestAverageKG\":70,\"latestAverageKG\":70.4,\"earliestPointCount\":7,\"latestPointCount\":7,\"days\":7,\"goalType\":\"bulk\",\"targetWeeklyDeltaKG\":0.25,\"actualWeeklyDeltaKG\":0.4,\"deviationKGPerWeek\":0.15,\"suggestedAdjustmentKcal\":-100,\"status\":\"suggested\",\"createdAt\":\"2026-09-21T12:00:00Z\"}]}, \"chat\": []")
        let calibratedPreview = try BackupRecovery.parse(calibrated)
        require(calibratedPreview.canApply
                    && calibratedPreview.data.dietCalibration.currentAdjustmentKcal == 100
                    && calibratedPreview.data.dietCalibration.evaluations.first?.status == .suggested,
                "校准模型应完整恢复")
        let encodedEvaluation = try JSONEncoder().encode(calibratedPreview.data.dietCalibration.evaluations[0])
        let encodedObject = try JSONSerialization.jsonObject(with: encodedEvaluation) as! [String: Any]
        require(encodedObject["currentWindowEnd"] as? String == "2026-09-14",
                "窗口字段必须以本地 YYYY-MM-DD 字符串持久化")
        let isoWindow = calibrated.replacingOccurrences(of: "\"latestWindowEnd\":\"2026-09-14\"",
                                                          with: "\"latestWindowEnd\":\"2026-09-14T00:00:00Z\"")
        let isoWindowPreview = try BackupRecovery.parse(isoWindow)
        require(!isoWindowPreview.canApply,
                "Web v3 窗口字符串带 ISO 时间时必须拒绝，不能截取日期掩盖错误")
        let calibrationMerged = try BackupRecovery.candidate(from: calibratedPreview, local: AppData(),
                                                               localChat: [], mode: .merge, policy: .backup)
        require(calibrationMerged.data.dietCalibration.evaluations.count == 1,
                "校准历史应参与 merge")
        var sameWindowDifferentID = calibratedPreview.data.dietCalibration.evaluations[0]
        sameWindowDifferentID.id = UUID()
        require(DietCalibrationEngine.matchesWindowSnapshot(sameWindowDifferentID,
                                                            windowEnd: "2026-09-14", goal: parsed.data.goal) == false,
                "目标类型或周目标快照不同不能误判重复")
        let calibratedGoal = Goal(type: .bulk, targetWeightKG: 75, targetBodyFatPct: nil,
                                  weeklyTargetDeltaKG: 0.25)
        require(sameWindowDifferentID.id != calibratedPreview.data.dietCalibration.evaluations[0].id
                    && DietCalibrationEngine.matchesWindowSnapshot(sameWindowDifferentID,
                                                                   windowEnd: "2026-09-14", goal: calibratedGoal),
                "相同窗口终点、目标类型和周目标快照必须判为重复，与 UUID 无关")
        let accepted = AppStore.applyingCalibrationAcceptance(to: calibratedPreview.data,
                                                               id: UUID(uuidString: evaluationID)!)
        let acceptedTwice = AppStore.applyingCalibrationAcceptance(to: accepted.0,
                                                                    id: UUID(uuidString: evaluationID)!)
        require(accepted.1 && accepted.0.dietCalibration.currentAdjustmentKcal == 0
                    && !acceptedTwice.1 && acceptedTwice.0.dietCalibration.currentAdjustmentKcal == 0,
                "重复接受同一建议必须幂等")

        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(secondsFromGMT: 0)!
        let start = ISO8601DateFormatter().date(from: "2026-09-01T08:00:00Z")!
        func metrics(lateDelta: Double, pointsPerWindow: Int = 7) -> [BodyMetric] {
            var values: [BodyMetric] = []
            for day in 0..<14 where day % 7 < pointsPerWindow {
                let date = utc.date(byAdding: .day, value: day, to: start)!
                values.append(BodyMetric(date: date, weightKG: 70 + (day >= 7 ? lateDelta : 0)))
            }
            return values
        }
        var duplicates = metrics(lateDelta: 0.4)
        duplicates.append(BodyMetric(date: utc.date(byAdding: .hour, value: 1, to: start)!, weightKG: 71))
        duplicates.append(BodyMetric(date: utc.date(byAdding: .hour, value: 2, to: start)!, weightKG: 20))
        require(DietCalibrationEngine.dailyWeights(duplicates, calendar: utc).first?.weightKG == 71,
                "同日本地自然日应取最后一条有效体重并过滤异常范围")
        require(DietCalibrationEngine.movingAverages(metrics(lateDelta: 0.4, pointsPerWindow: 3), calendar: utc).isEmpty,
                "7 日窗口 3 点不得生成移动平均")
        require(!DietCalibrationEngine.movingAverages(metrics(lateDelta: 0.4, pointsPerWindow: 4), calendar: utc).isEmpty,
                "7 日窗口 4 点应生成移动平均")

        let bulk = Goal(type: .bulk, targetWeightKG: 75, targetBodyFatPct: nil, weeklyTargetDeltaKG: 0.25)
        let now = utc.date(byAdding: .day, value: 13, to: start)!
        let below = DietCalibrationEngine.evaluation(metrics: metrics(lateDelta: 0.399), goal: bulk,
                                                      history: [], currentAdjustmentKcal: 0,
                                                      now: now, calendar: utc)
        let threshold = DietCalibrationEngine.evaluation(metrics: metrics(lateDelta: 0.4), goal: bulk,
                                                          history: [], currentAdjustmentKcal: 0,
                                                          now: now, calendar: utc)
        require(below.status == .withinRange && threshold.status == .deviating,
                "0.149 不偏离，0.150 达到偏离阈值")
        require(DietCalibrationEngine.formalEvaluation(metrics: metrics(lateDelta: 0.4), goal: bulk,
                                                       history: [threshold], currentAdjustmentKcal: 0,
                                                       now: now, calendar: utc) == nil,
                "formal evaluation 对相同窗口终点、目标类型和周目标快照必须防重")
        var prior = threshold
        prior.createdAt = now
        prior.latestWindowEnd = "2026-09-07"
        let suggested = DietCalibrationEngine.evaluation(metrics: metrics(lateDelta: 0.4), goal: bulk,
                                                          history: [prior], currentAdjustmentKcal: 0,
                                                          now: now, calendar: utc)
        require(suggested.status == .suggested && suggested.suggestedAdjustmentKcal == -100,
                "窗口终点恰好相隔 7 个本地自然日时，连续同向偏离应建议 100 kcal")
        var staleWindow = prior
        staleWindow.latestWindowEnd = "2026-09-06"
        staleWindow.createdAt = utc.date(byAdding: .day, value: -7, to: now)!
        require(DietCalibrationEngine.evaluation(metrics: metrics(lateDelta: 0.4), goal: bulk,
                                                  history: [staleWindow], currentAdjustmentKcal: 0,
                                                  now: now, calendar: utc).status == .deviating,
                "createdAt 相隔 7 天但窗口终点不相隔 7 天时不得视为连续")
        let cut = Goal(type: .cut, targetWeightKG: 65, targetBodyFatPct: nil, weeklyTargetDeltaKG: 0.25)
        var cutPrior = DietCalibrationEngine.evaluation(metrics: metrics(lateDelta: -0.4), goal: cut,
                                                         history: [], currentAdjustmentKcal: 0,
                                                         now: now, calendar: utc)
        cutPrior.createdAt = now
        cutPrior.latestWindowEnd = "2026-09-07"
        let cutSuggested = DietCalibrationEngine.evaluation(metrics: metrics(lateDelta: -0.4), goal: cut,
                                                             history: [cutPrior], currentAdjustmentKcal: 0,
                                                             now: now, calendar: utc)
        require(cutSuggested.suggestedAdjustmentKcal == 100,
                "减脂过快且连续同向偏离应建议增加热量")
        var changedGoalPrior = prior
        changedGoalPrior.targetWeeklyDeltaKG = 0.2
        let changedGoal = DietCalibrationEngine.evaluation(metrics: metrics(lateDelta: 0.4), goal: bulk,
                                                            history: [changedGoalPrior], currentAdjustmentKcal: 0,
                                                            now: now, calendar: utc)
        require(changedGoal.status == .deviating && changedGoal.suggestedAdjustmentKcal == nil,
                "目标周变化快照改变后旧连续状态不得参与")
        let strong = DietCalibrationEngine.evaluation(metrics: metrics(lateDelta: 0.55), goal: bulk,
                                                       history: [prior], currentAdjustmentKcal: 0,
                                                       now: now, calendar: utc)
        require(strong.suggestedAdjustmentKcal == -150, "当前偏离达到 0.30 应建议 150 kcal")
        prior.deviationKGPerWeek = -0.2
        let reversed = DietCalibrationEngine.evaluation(metrics: metrics(lateDelta: 0.4), goal: bulk,
                                                         history: [prior], currentAdjustmentKcal: 0,
                                                         now: now, calendar: utc)
        require(reversed.status == .deviating && reversed.suggestedAdjustmentKcal == nil,
                "方向反转应重置连续状态")
        let maintain = Goal(type: .maintain, targetWeightKG: 70, targetBodyFatPct: nil, weeklyTargetDeltaKG: 0.25)
        require(DietCalibrationEngine.evaluation(metrics: metrics(lateDelta: 1), goal: maintain,
                                                  history: [prior], currentAdjustmentKcal: 0,
                                                  now: now, calendar: utc).suggestedAdjustmentKcal == nil,
                "维持目标不产生建议")
        var capPrior = threshold
        capPrior.latestWindowEnd = "2026-09-07"
        let limited = DietCalibrationEngine.evaluation(metrics: metrics(lateDelta: 0.4), goal: bulk,
                                                        history: [capPrior], currentAdjustmentKcal: -900,
                                                        now: now, calendar: utc)
        require(limited.suggestedAdjustmentKcal == nil, "总调整余量不足 100 时不得建议")
        let reducedStrong = DietCalibrationEngine.evaluation(metrics: metrics(lateDelta: 0.55), goal: bulk,
                                                              history: [capPrior], currentAdjustmentKcal: -850,
                                                              now: now, calendar: utc)
        require(reducedStrong.suggestedAdjustmentKcal == -100,
                "150 kcal 建议方向仅剩 100...149 kcal 余量时应降为正常 100 kcal")
        let profile = UserProfile(sex: "male", age: 25, heightCM: 175, activityLevel: 1.2, trainingDaysPerWeek: 4)
        require(DietPlanner.strategy(profile: profile, goal: bulk, weightKG: 30,
                                     calibrationKcal: -700).targetKcal == 1200,
                "最终热量必须保持 1200 下限")
        require(DietPlanner.targets(profile: profile, goal: bulk, weightKG: 70)
                    == DietPlanner.targets(profile: profile, goal: bulk, weightKG: 70, calibrationKcal: 0),
                "零校准必须保持旧结果")

        var losAngeles = Calendar(identifier: .gregorian)
        losAngeles.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        let dstStart = ISO8601DateFormatter().date(from: "2026-03-02T16:00:00Z")!
        var dstMetrics: [BodyMetric] = []
        for day in 0..<14 {
            let date = losAngeles.date(byAdding: .day, value: day, to: dstStart)!
            dstMetrics.append(BodyMetric(date: date, weightKG: 70 + (day >= 7 ? 0.4 : 0)))
        }
        let dstEvaluation = DietCalibrationEngine.evaluation(metrics: dstMetrics, goal: bulk,
                                                              history: [], currentAdjustmentKcal: 0,
                                                              now: dstMetrics.last!.date, calendar: losAngeles)
        require(dstEvaluation.days == 7 && dstEvaluation.status == .deviating,
                "跨夏令时仍应按本地自然日得到 7 天平均日期差")

        print("restore/calibration oracle passed")
    }
}
