import SwiftUI
import Charts
import UniformTypeIdentifiers

// MARK: - 导航

enum Section: String, CaseIterable, Identifiable {
    case dashboard = "概览"
    case training = "训练"
    case diet = "饮食"
    case body = "身体"
    case aiChat = "AI 助手"
    case importExport = "导入导出"
    case profile = "设置"
    var id: String { rawValue }
    var icon: String {
        switch self {
        case .dashboard: return "gauge"
        case .training: return "dumbbell"
        case .diet: return "fork.knife"
        case .body: return "heart.text.square"
        case .aiChat: return "bubble.left.and.bubble.right"
        case .importExport: return "square.and.arrow.down"
        case .profile: return "gearshape"
        }
    }
}

struct ContentView: View {
    @State private var selection: Section? = .dashboard
    var body: some View {
        NavigationSplitView {
            List(Section.allCases, selection: $selection) { s in
                Label(s.rawValue, systemImage: s.icon).tag(s)
            }
            .navigationSplitViewColumnWidth(min: 160, ideal: 180)
        } detail: {
            switch selection ?? .dashboard {
            case .dashboard: DashboardView()
            case .training: TrainingView()
            case .diet: DietView()
            case .body: BodyView()
            case .aiChat: AIChatView()
            case .importExport: ImportView()
            case .profile: ProfileView()
            }
        }
    }
}

// MARK: - 通用小组件

struct StatCard: View {
    let title: String
    let value: String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title2.bold())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.gray.opacity(0.12)))
    }
}

// MARK: - 概览

struct DashboardView: View {
    @EnvironmentObject var store: AppStore
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("概览").font(.largeTitle.bold())
                HStack(spacing: 16) {
                    StatCard(title: "最新体重", value: store.latestWeight.map { String(format: "%.1f kg", $0) } ?? "—")
                    StatCard(title: "目标体重", value: String(format: "%.1f kg", store.data.goal.targetWeightKG))
                    StatCard(title: "训练记录", value: "\(store.data.workouts.count) 次")
                    StatCard(title: "身体数据", value: "\(store.data.bodyMetrics.count) 条")
                }
                if let m = store.sortedMetrics.last {
                    GoalProgressView(metric: m, goal: store.data.goal)
                }
                TodayPlanView()
            }
            .padding(24)
        }
    }
}

struct GoalProgressView: View {
    let metric: BodyMetric
    let goal: Goal
    var body: some View {
        let delta = goal.targetWeightKG - metric.weightKG
        GroupBox("目标进度") {
            VStack(alignment: .leading, spacing: 6) {
                Text("目标：\(goal.type.label)").font(.headline)
                Text("当前 \(String(format: "%.1f", metric.weightKG)) kg · 目标 \(String(format: "%.1f", goal.targetWeightKG)) kg")
                Text(delta > 0 ? "还需增重 \(String(format: "%.1f", delta)) kg" : "还需减重 \(String(format: "%.1f", abs(delta))) kg")
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(6)
        }
    }
}

struct TodayPlanView: View {
    @EnvironmentObject var store: AppStore
    @State private var hint = ""
    private var bodyWeight: Double { store.currentBodyWeightKG }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("今日训练计划").font(.title2.bold())
                Spacer()
                GeneratePlanButton { hint = $0 }
            }
            if !hint.isEmpty { Text(hint).font(.caption).foregroundStyle(.secondary) }
            let todays = store.planned(on: .now)
            if todays.isEmpty {
                Text("今日暂无计划，点击右上角生成；生成后可在卡片上「编辑」。").foregroundStyle(.secondary)
            } else {
                ForEach(todays) { w in
                    PlanCard(workout: w, bodyWeightKG: bodyWeight, heightCM: store.data.profile.heightCM)
                }
            }
        }
    }
}

struct PlanCard: View {
    @EnvironmentObject var store: AppStore
    let workout: PlannedWorkout
    let bodyWeightKG: Double
    let heightCM: Double
    @State private var editing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(workout.splitName).font(.headline)
                Spacer()
                Text(workout.status.label).font(.caption).foregroundStyle(.secondary)
                Button("编辑") { editing = true }
                    .controlSize(.small)
            }
            if let note = workout.note, !note.isEmpty {
                Text(note).font(.caption).foregroundStyle(.secondary)
            }
            ForEach(workout.exercises) { ex in
                HStack {
                    Text(ex.name)
                    Spacer()
                    Text("\(ex.targetSets)×\(ex.targetReps)  \(ex.weightLabel)  ·  \(String(format: "%.0f 千卡", CalorieEstimator.calories(for: ex, bodyWeightKG: bodyWeightKG, heightCM: heightCM)))")
                        .foregroundStyle(.secondary)
                }
                .font(.callout)
            }
            Text("预计消耗 \(String(format: "%.0f", CalorieEstimator.total(workout: workout, bodyWeightKG: bodyWeightKG, heightCM: heightCM))) 千卡\(heightFactorNote)")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.gray.opacity(0.1)))
        .sheet(isPresented: $editing) { PlanEditorView(workout: workout) }
    }

    /// 让身高的行程修正可见：这是估算模型里的假设，不是实测值
    private var heightFactorNote: String {
        let base = CalorieEstimator.baseTotal(workout: workout, bodyWeightKG: bodyWeightKG)
        guard base > 0 else { return "" }
        let adjusted = CalorieEstimator.total(workout: workout, bodyWeightKG: bodyWeightKG, heightCM: heightCM)
        return String(format: "（身高 %.0fcm 行程修正 ×%.2f）", heightCM, adjusted / base)
    }
}

/// 今日计划的可编辑面板：改名称、增删动作、改组数/次数/重量。
/// 不做额外的配重推导：用户手填多少就是多少，只在换成自重动作时把重量清零。
struct PlanEditorView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let workout: PlannedWorkout

    @State private var splitName: String
    @State private var rows: [PlannedExercise]

    init(workout: PlannedWorkout) {
        self.workout = workout
        _splitName = State(initialValue: workout.splitName)
        _rows = State(initialValue: workout.exercises)
    }

    /// 计划里可能有动作库外的动作（比如从 Mac 版导入的），一并给个选项，免得下拉框把它吃掉
    private var exerciseNames: [String] {
        var names = store.data.exercises.map { $0.name }
        for r in rows where !names.contains(r.name) { names.append(r.name) }
        return names
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("编辑今日计划").font(.headline)

            HStack {
                Text("计划名称").foregroundStyle(.secondary)
                TextField("胸 / 背 / 腿 / 自定名称", text: $splitName)
                    .textFieldStyle(.roundedBorder)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach($rows) { $row in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Picker("动作", selection: $row.name) {
                                    ForEach(exerciseNames, id: \.self) { Text($0).tag($0) }
                                }
                                .labelsHidden()
                                Button {
                                    rows.removeAll { $0.id == row.id }
                                } label: {
                                    Image(systemName: "trash")
                                }
                                .buttonStyle(.borderless)
                                .foregroundStyle(.red)
                            }
                            HStack(spacing: 10) {
                                Text("组数")
                                TextField("", value: $row.targetSets, format: .number).frame(width: 46)
                                Text("次数")
                                TextField("", value: $row.targetReps, format: .number).frame(width: 46)
                                Text("重量")
                                TextField("", value: $row.targetWeightKG, format: .number).frame(width: 64)
                                Text("kg")
                            }
                            .font(.callout)
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.gray.opacity(0.08)))
                        .onChange(of: row.name) { _, newValue in
                            if CalorieEstimator.isBodyweight(newValue) { row.targetWeightKG = 0 }
                        }
                    }
                }
            }
            .frame(maxHeight: 320)

            HStack {
                Button {
                    addRow()
                } label: {
                    Label("添加动作", systemImage: "plus")
                }
                if rows.isEmpty {
                    Text("至少保留一个动作才能保存").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("取消") { dismiss() }
                Button("保存") { save() }
                    .buttonStyle(.borderedProminent)
                    .disabled(rows.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 460)
    }

    private func addRow() {
        let name = store.data.exercises.first?.name ?? "杠铃卧推"
        let reps = 10
        let weight = CalorieEstimator.isBodyweight(name)
            ? 0
            : StrengthModel.prescribedWeight(for: name, reps: reps, data: store.data,
                                             bodyWeightKG: store.currentBodyWeightKG)
        rows.append(PlannedExercise(name: name, targetSets: 3, targetReps: reps,
                                    targetWeightKG: max(0, weight)))
    }

    private func save() {
        let name = splitName.trimmingCharacters(in: .whitespaces)
        let cleaned = rows.map { r -> PlannedExercise in
            var c = r
            c.targetSets = r.targetSets.clamped(to: 1...10)
            c.targetReps = r.targetReps.clamped(to: 1...30)
            c.targetWeightKG = max(0, CalorieEstimator.isBodyweight(r.name) ? 0 : r.targetWeightKG)
            return c
        }
        store.updatePlannedWorkout(id: workout.id,
                                   splitName: name.isEmpty ? workout.splitName : name,
                                   exercises: cleaned)
        dismiss()
    }
}

/// 生成今日计划的入口：先选部位（胸/背/腿/自定义），再交给 AI 或固定模板。
/// 网页版同款；Mac 版原来是按星期固定轮转，没有选择。
struct GeneratePlanButton: View {
    @EnvironmentObject var store: AppStore
    /// 结果提示：由调用方决定显示在哪儿
    var onResult: (String) -> Void = { _ in }

    @State private var showPicker = false
    @State private var focus: SplitFocus = .chest
    @State private var custom = ""
    @State private var busy = false

    private var chosen: String {
        focus == .custom ? custom.trimmingCharacters(in: .whitespaces) : focus.rawValue
    }

    var body: some View {
        Button {
            showPicker = true
        } label: {
            Label("生成今日计划", systemImage: "sparkles")
        }
        .disabled(busy)
        .sheet(isPresented: $showPicker) { picker }
    }

    private var picker: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("生成今日计划").font(.headline)
            Text("选择今天练什么").font(.caption).foregroundStyle(.secondary)

            Picker("训练主题", selection: $focus) {
                ForEach(SplitFocus.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            if focus == .custom {
                TextField("自定义内容（部位或动作，如「肩+三头」「全身」）", text: $custom)
                    .textFieldStyle(.roundedBorder)
            }

            Text(AIService.hasKey()
                 ? "将结合训练历史与身体数据，由 AI 生成动作与配重。"
                 : "未设置 API Key：将用固定模板生成（在「AI 助手」页设置 Key 后可启用 AI 生成）。")
                .font(.caption).foregroundStyle(.secondary)

            if busy {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("正在生成…").font(.caption)
                }
            }

            HStack {
                Spacer()
                Button("取消") { showPicker = false }
                Button("生成") { generate() }
                    .buttonStyle(.borderedProminent)
                    .disabled(busy || chosen.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 420)
    }

    private func generate() {
        let topic = chosen
        guard !topic.isEmpty, !busy else { return }
        busy = true
        let snapshot = store.data
        Task {
            let result = await AIService.generatePlanWithFallback(data: snapshot, date: .now, focus: topic)
            await MainActor.run {
                let added = store.addPlannedWorkout(result.plan)
                busy = false
                showPicker = false
                if !added {
                    onResult("今日已有「\(topic)」计划，未重复添加")
                } else {
                    onResult(result.usedAI
                             ? "已由 AI 生成「\(topic)」计划"
                             : "未设置 API Key，已用固定模板生成「\(topic)」计划（在「AI 助手」页设置 Key 后可启用 AI 生成）")
                }
            }
        }
    }
}

// MARK: - 训练

struct TrainingView: View {
    @EnvironmentObject var store: AppStore
    @State private var syncMessage = ""
    @State private var showingAddLog = false
    @State private var exportingICS = false
    @State private var planHint = ""
    @State private var reminderObserver: NSObjectProtocol?
    @State private var showClearAllConfirm = false
    @State private var showDeleteConfirm = false
    @State private var pendingDelete: WorkoutSession?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("训练").font(.largeTitle.bold())
                HStack(spacing: 12) {
                    GeneratePlanButton { planHint = $0 }
                    Button { Task { @MainActor in await sync() } } label: { Label("同步到提醒事项", systemImage: "bell.badge") }
                    Button { Task { await refreshFromReminders() } } label: { Label("刷新状态", systemImage: "arrow.triangle.2.circlepath") }
                    Button { exportingICS = true } label: { Label("导出 .ics 日历", systemImage: "calendar.badge.plus") }
                    Spacer()
                    Button { showingAddLog = true } label: { Label("记录一次训练", systemImage: "plus") }
                }
                if !planHint.isEmpty {
                    Text(planHint).font(.callout).foregroundStyle(.secondary)
                }
                if !syncMessage.isEmpty {
                    Text(syncMessage).font(.callout).foregroundStyle(.secondary)
                }

                GroupBox("进行中的计划") {
                    let upcoming = store.data.plannedWorkouts
                        .filter { $0.status == .planned }
                        .sorted { $0.date < $1.date }
                    if upcoming.isEmpty {
                        Text("暂无待完成计划").foregroundStyle(.secondary).padding(6)
                    } else {
                        ForEach(upcoming) { w in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(w.splitName) · \(w.date, style: .date)").font(.headline)
                                    Text(w.exercises.map { $0.name }.joined(separator: " / "))
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button("完成") { complete(w) }
                                Button("跳过") { skip(w) }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }

                GroupBox {
                    if store.sortedWorkouts.isEmpty {
                        Text("暂无记录").foregroundStyle(.secondary).padding(6)
                    } else {
                        ForEach(store.sortedWorkouts.prefix(50)) { w in
                            HStack {
                                Text(w.date, style: .date).frame(width: 90, alignment: .leading)
                                Text(w.splitName).frame(width: 80, alignment: .leading)
                                Text(w.exercises.map { "\($0.name)" }.joined(separator: ", "))
                                    .lineLimit(1).foregroundStyle(.secondary)
                                Spacer()
                                Button("删除") { pendingDelete = w; showDeleteConfirm = true }
                                    .buttonStyle(.borderless)
                                    .foregroundStyle(.red)
                            }
                            .font(.callout)
                            .padding(.vertical, 2)
                        }
                    }
                } label: {
                    HStack {
                        Label("历史训练（\(store.sortedWorkouts.count) 次）", systemImage: "clock")
                        Spacer()
                        Button("清空全部") { showClearAllConfirm = true }
                            .buttonStyle(.borderless)
                            .foregroundStyle(.red)
                            .disabled(store.sortedWorkouts.isEmpty)
                    }
                }
            }
            .padding(24)
        }
        .sheet(isPresented: $showingAddLog) { AddLogView() }
        .fileExporter(isPresented: $exportingICS,
                      document: TextDocument(text: ICSExporter.ics(for: upcomingICS(),
                                                                    bodyWeightKG: store.currentBodyWeightKG,
                                                                    heightCM: store.data.profile.heightCM)),
                      contentType: .plainText, defaultFilename: "训练计划.ics") { _ in }
        .onAppear {
            Task { await refreshFromReminders() }
            if reminderObserver == nil {
                reminderObserver = NotificationCenter.default.addObserver(
                    forName: .EKEventStoreChanged, object: RemindersSync.store, queue: .main
                ) { _ in
                    Task { await refreshFromReminders() }
                }
            }
        }
        .onDisappear {
            if let o = reminderObserver {
                NotificationCenter.default.removeObserver(o)
                reminderObserver = nil
            }
        }
        .confirmationDialog("清空所有历史训练记录？", isPresented: $showClearAllConfirm, titleVisibility: .visible) {
            Button("清空全部", role: .destructive) { store.clearWorkouts() }
            Button("取消", role: .cancel) {}
        } message: {
            Text("将删除 \(store.sortedWorkouts.count) 条训练记录，且不可恢复。")
        }
        .confirmationDialog("删除这条训练记录？", isPresented: $showDeleteConfirm, presenting: pendingDelete) { w in
            Button("删除", role: .destructive) { store.deleteWorkout(id: w.id) }
            Button("取消", role: .cancel) {}
        } message: { w in
            Text("\(w.date, style: .date) · \(w.splitName)")
        }
    }

    private func upcomingICS() -> [PlannedWorkout] {
        store.data.plannedWorkouts.filter { $0.status == .planned }.sorted { $0.date < $1.date }
    }

    private func complete(_ w: PlannedWorkout) {
        finishLocally(w)
        if let rid = w.reminderID {
            Task { await RemindersSync.markCompleted(reminderID: rid) }
        }
    }

    private func skip(_ w: PlannedWorkout) {
        if let idx = store.data.plannedWorkouts.firstIndex(where: { $0.id == w.id }) {
            store.data.plannedWorkouts[idx].status = .skipped
            store.save()
        }
        if let rid = w.reminderID {
            Task { await RemindersSync.markDeleted(reminderID: rid) }
        }
    }

    /// 本地把计划置为已完成并写入训练历史（幂等，只处理 planned → completed）
    private func finishLocally(_ w: PlannedWorkout) {
        guard let idx = store.data.plannedWorkouts.firstIndex(where: { $0.id == w.id }),
              store.data.plannedWorkouts[idx].status == .planned else { return }
        store.data.plannedWorkouts[idx].status = .completed
        let exercises = w.exercises.map { ex -> ExerciseEntry in
            let sets = (0..<max(1, ex.targetSets)).map { _ in
                SetEntry(reps: ex.targetReps, weightKG: ex.targetWeightKG)
            }
            return ExerciseEntry(name: ex.name, sets: sets)
        }
        store.data.workouts.append(WorkoutSession(date: w.date, splitName: w.splitName,
                                                  exercises: exercises, durationMin: 60))
        store.save()
    }

    @MainActor
    private func sync() async {
        // 只同步尚未建立关联的计划，避免重复创建提醒
        let upcoming = upcomingICS().filter { $0.reminderID == nil }
        guard !upcoming.isEmpty else {
            syncMessage = "待完成计划均已同步，无新增提醒"
            return
        }
        let res = await RemindersSync.syncToReminders(workouts: upcoming,
                                                      bodyWeightKG: store.currentBodyWeightKG,
                                                      heightCM: store.data.profile.heightCM)
        switch res {
        case .success(let links):
            var changed = false
            for (i, w) in store.data.plannedWorkouts.enumerated() {
                if let rid = links[w.id] {
                    store.data.plannedWorkouts[i].reminderID = rid
                    changed = true
                }
            }
            if changed { store.save() }
            syncMessage = "已同步 \(links.count) 条到「提醒事项」"
        case .failure(let e):
            syncMessage = "同步失败：\(e.localizedDescription)（若未签名构建，请改用「导出 .ics」）"
        }
    }

    /// 从提醒事项拉取完成状态：若在提醒 App 里点了完成，则本地也标记完成
    @MainActor
    private func refreshFromReminders() async {
        let pending = store.data.plannedWorkouts.filter { $0.status == .planned && $0.reminderID != nil }
        guard !pending.isEmpty else { return }
        let ids = pending.compactMap { $0.reminderID }
        let status = await RemindersSync.fetchStatus(ids: ids)
        guard !status.isEmpty else { return }
        for w in pending {
            if status[w.reminderID ?? ""] == true {
                finishLocally(w)
            }
        }
    }
}

struct AddLogView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) var dismiss
    @State private var splitName = "训练"
    @State private var exerciseName = "杠铃卧推"
    @State private var reps = 8
    @State private var weight = 0.0
    @State private var sets = 3

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("记录一次训练").font(.title2.bold())
            TextField("拆分名称", text: $splitName)
            Picker("动作", selection: $exerciseName) {
                ForEach(store.data.exercises) { Text($0.name).tag($0.name) }
            }
            Stepper("组数 \(sets)", value: $sets, in: 1...10)
            Stepper("每组次数 \(reps)", value: $reps, in: 1...30)
            TextField("重量 (kg，自重填 0)", value: $weight, format: .number)
            HStack {
                Button("取消") { dismiss() }
                Spacer()
                Button("保存") {
                    let entry = ExerciseEntry(name: exerciseName,
                        sets: (0..<sets).map { _ in SetEntry(reps: reps, weightKG: weight) })
                    store.data.workouts.append(WorkoutSession(date: .now, splitName: splitName,
                                                              exercises: [entry], durationMin: 0))
                    store.save()
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .frame(width: 380)
        .onAppear {
            if let f = store.data.exercises.first { exerciseName = f.name }
        }
    }
}

// MARK: - AI 助手

struct AIChatView: View {
    @EnvironmentObject var store: AppStore
    @State private var draft = ""
    @State private var busy = false
    @State private var hasKey = AIService.hasKey()
    @State private var apiKey = AICredentials.load() ?? ""
    @State private var showClearConfirm = false

    private let maxHistory = 40

    var body: some View {
        VStack(spacing: 0) {
            if !hasKey {
                keyBanner
                Divider()
            }
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(store.chatMessages) { m in
                            VStack(alignment: .leading, spacing: 8) {
                                ChatBubble(message: m)
                                if let json = m.proposal,
                                   let payload = AppStore.decodePayload(json) {
                                    ProposalCard(messageID: m.id, payload: payload,
                                                 status: m.proposalStatus ?? "",
                                                 applied: m.proposalResult ?? [])
                                }
                            }
                        }
                        if busy { HStack { ProgressView().controlSize(.small); Text("思考中…").font(.caption).foregroundStyle(.secondary) }.padding(.leading, 4) }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .onChange(of: store.chatMessages.count) { _ in
                    withAnimation { proxy.scrollTo("bottom") }
                }
            }
            Divider()
            HStack(spacing: 8) {
                TextField("问：这个动作能换成什么？…", text: $draft)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { send() }
                Button("发送") { send() }
                    .buttonStyle(.borderedProminent)
                    .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                Button("清空") { showClearConfirm = true }
                    .disabled(store.chatMessages.isEmpty)
            }
            .padding(12)
        }
        .navigationTitle("AI 助手")
        .onAppear { seedGreeting() }
        .confirmationDialog("清空聊天记录？", isPresented: $showClearConfirm, titleVisibility: .visible) {
            Button("清空", role: .destructive) { store.clearChat() }
            Button("取消", role: .cancel) {}
        } message: {
            Text("将删除全部聊天记录，且不可恢复。")
        }
    }

    private var keyBanner: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("需要 DeepSeek API Key 才能使用 AI 功能").font(.callout).foregroundStyle(.secondary)
            HStack {
                SecureField("粘贴 API Key（sk-…）", text: $apiKey)
                    .textFieldStyle(.roundedBorder)
                Button("保存") {
                    AICredentials.save(apiKey)
                    hasKey = AIService.hasKey()
                    seedGreeting()
                }
                .buttonStyle(.borderedProminent)
                .disabled(apiKey.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(12)
        .background(Color.orange.opacity(0.12))
    }

    private func seedGreeting() {
        guard store.chatMessages.isEmpty else { return }
        if AIService.hasKey() {
            store.appendChat(ChatMessage(role: "assistant",
                content: "你好！我是你的 AI 健身助手，可以看到你的训练历史、身体数据与今日计划。可以问我动作替换、动作规范、计划调整或饮食问题，例如：“杠铃卧推肩膀不舒服，能换成什么动作？”\n\n也可以直接让我改今日计划（比如“把今天的卧推换成哑铃卧推”“深蹲减一组”），或告诉我你的长期目标与限制（比如“我想增肌增强力量，每周只能练 4 天”）。这些改动都会先给出待确认卡片，你点「应用」后才会写入。"))
        }
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty, hasKey else { return }
        store.appendChat(ChatMessage(role: "user", content: text))
        draft = ""
        busy = true
        let context = AIService.contextString(store.data)
        // 构造历史：跳过开头连续的 assistant 消息（欢迎语），确保从 user 开始
        var history: [(role: String, content: String)] = []
        var started = false
        for m in store.chatMessages {
            if !started && m.role != "user" { continue }
            started = true
            history.append((role: m.role, content: m.content))
        }
        Task {
            do {
                let reply = try await AIService.chat(history: history, context: context)
                await MainActor.run {
                    store.appendChat(ChatMessage(role: "assistant", content: reply.text,
                                                 proposal: reply.proposalJSON))
                    store.trimChat(to: maxHistory)
                    busy = false
                }
            } catch {
                await MainActor.run {
                    store.appendChat(ChatMessage(role: "assistant", content: "出错：\(error.localizedDescription)"))
                    store.trimChat(to: maxHistory)
                    busy = false
                }
            }
        }
    }
}

/// AI 提出的资料变更确认卡片：用户点「应用」才写入
struct ProposalCard: View {
    @EnvironmentObject var store: AppStore
    let messageID: UUID
    let payload: AIUpdatePayload
    let status: String
    let applied: [String]

    var body: some View {
        let pending = AppStore.plannedChanges(payload, in: store.data).changes
        let scope = proposalScope(payload)
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: status == "applied" ? "checkmark.circle.fill" : "wand.and.stars")
                Text(status == "applied" ? "已应用到\(scope)" : "建议更新\(scope)").font(.caption.bold())
            }
            .foregroundStyle(status == "applied" ? .green : .secondary)

            if status == "dismissed" {
                Text("已忽略这条建议").font(.callout).foregroundStyle(.secondary)
            } else {
                if let reason = payload.reason, !reason.isEmpty {
                    Text(reason).font(.caption).foregroundStyle(.secondary)
                }
                let lines = status == "applied" ? applied : pending
                if lines.isEmpty {
                    Text(status == "applied" ? "没有实际改动。" : "这些内容已经是最新的。")
                        .font(.callout).foregroundStyle(.secondary)
                } else {
                    ForEach(lines, id: \.self) { line in
                        Text("• \(line)").font(.callout)
                    }
                }
                if status.isEmpty {
                    HStack {
                        Button("忽略") { store.setProposalStatus(messageID: messageID, status: "dismissed") }
                        Spacer()
                        Button("应用") { store.applyProposal(messageID: messageID) }
                            .buttonStyle(.borderedProminent)
                            .disabled(pending.isEmpty)
                    }
                    .padding(.top, 2)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: 460, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10)
            .fill((status == "applied" ? Color.green : Color.accentColor).opacity(0.08)))
        .overlay(RoundedRectangle(cornerRadius: 10)
            .stroke((status == "applied" ? Color.green : Color.accentColor).opacity(0.3)))
    }

    /// 这张卡片会改到哪儿：长期个人资料、今日计划，还是两者都有
    private func proposalScope(_ p: AIUpdatePayload) -> String {
        let personal = p.profile != nil || p.goal != nil || p.bigThree != nil
            || !(p.notes ?? []).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.isEmpty
        let plan = p.plan?.hasAnyChange ?? false
        if plan && personal { return "个人资料与今日计划" }
        return plan ? "今日训练计划" : "个人资料"
    }
}

struct ChatBubble: View {
    let message: ChatMessage
    var body: some View {
        let isUser = message.role == "user"
        HStack {
            if isUser { Spacer(minLength: 60) }
            Text(message.content)
                .padding(10)
                .background(isUser ? Color.accentColor.opacity(0.85) : Color.gray.opacity(0.15))
                .foregroundStyle(isUser ? .white : .primary)
                .cornerRadius(12)
                .textSelection(.enabled)
            if !isUser { Spacer(minLength: 60) }
        }
    }
}

// MARK: - 饮食

struct DietView: View {
    @EnvironmentObject var store: AppStore
    @State private var logFoodName = ""
    @State private var logAmount = 100.0

    private var weight: Double { store.currentBodyWeightKG }
    private var strategy: DietStrategy {
        DietPlanner.strategy(profile: store.data.profile, goal: store.data.goal, weightKG: weight)
    }
    private var target: Macros {
        DietPlanner.targets(profile: store.data.profile, goal: store.data.goal, weightKG: weight)
    }
    private var consumed: Macros {
        DietPlanner.summary(on: .now, logs: store.data.dietLogs, foods: store.data.foods)
    }
    private var remaining: Macros {
        Macros(kcal: target.kcal - consumed.kcal,
               protein: target.protein - consumed.protein,
               carb: target.carb - consumed.carb,
               fat: target.fat - consumed.fat)
    }
    private var todayLogs: [DietLog] {
        store.data.dietLogs.filter { Calendar.current.isDateInToday($0.date) }.sorted { $0.date > $1.date }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("饮食").font(.largeTitle.bold())

                GroupBox("目标策略 · 当前体重 \(String(format: "%.1f", weight)) kg") {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(String(format: "TDEE %.0f 千卡 · 目标热量 %.0f 千卡", strategy.tdee, target.kcal))
                            .font(.headline)
                        Text(strategy.description).foregroundStyle(.secondary)
                        Text(String(format: "蛋白质 %.0f g · 碳水 %.0f g · 脂肪 %.0f g",
                                    target.protein, target.carb, target.fat))
                            .font(.callout)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(6)
                }

                GroupBox("今日摄入") {
                    VStack(alignment: .leading, spacing: 8) {
                        nutritionRow("热量", unit: "kcal", consumed: consumed.kcal,
                                     target: target.kcal, remaining: remaining.kcal)
                        nutritionRow("蛋白质", unit: "g", consumed: consumed.protein,
                                     target: target.protein, remaining: remaining.protein)
                        nutritionRow("碳水", unit: "g", consumed: consumed.carb,
                                     target: target.carb, remaining: remaining.carb)
                        nutritionRow("脂肪", unit: "g", consumed: consumed.fat,
                                     target: target.fat, remaining: remaining.fat)
                    }
                    .padding(6)
                }

                GroupBox("饮食建议") {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(DietPlanner.suggestions(target: target, consumed: consumed), id: \.self) {
                            Text("• \($0)").font(.callout)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(6)
                }

                GroupBox("记录饮食") {
                    HStack {
                        Picker("食物", selection: $logFoodName) {
                            ForEach(store.data.foods) { Text($0.name).tag($0.name) }
                        }
                        .frame(width: 180)
                        TextField("克数", value: $logAmount, format: .number).frame(width: 80)
                        Button("添加") { addLog() }
                            .buttonStyle(.borderedProminent)
                            .disabled(logFoodName.isEmpty || logAmount <= 0)
                    }
                    .padding(6)
                }

                GroupBox("今日日志") {
                    if todayLogs.isEmpty {
                        Text("今天还没有饮食记录").foregroundStyle(.secondary).padding(6)
                    } else {
                        ForEach(todayLogs) { log in
                            let item = DietPlanner.nutrition(for: log, foods: store.data.foods)
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(log.foodName) · \(String(format: "%.0f", log.amountG))g")
                                    Text(String(format: "%.0f kcal · 蛋白 %.1fg · 碳水 %.1fg · 脂肪 %.1fg",
                                                item.kcal, item.protein, item.carb, item.fat))
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(log.date, style: .time).font(.caption).foregroundStyle(.secondary)
                                Button("删除", role: .destructive) { store.deleteDietLog(id: log.id) }
                                    .buttonStyle(.borderless)
                            }
                            .padding(.vertical, 3)
                        }
                    }
                }

                GroupBox("食物库（每 100g）") {
                    ForEach(store.data.foods) { f in
                        HStack {
                            Text(f.name).frame(width: 130, alignment: .leading)
                            Text(String(format: "%.0f kcal", f.kcalPer100g)).frame(width: 80, alignment: .leading)
                            Text(String(format: "蛋白 %.0fg", f.proteinPer100g)).frame(width: 90, alignment: .leading)
                            Text(String(format: "碳水 %.0fg", f.carbPer100g)).frame(width: 90, alignment: .leading)
                            Text(String(format: "脂肪 %.0fg", f.fatPer100g))
                            Spacer()
                        }
                        .font(.callout)
                    }
                }
            }
            .padding(24)
        }
        .onAppear {
            if logFoodName.isEmpty, let f = store.data.foods.first { logFoodName = f.name }
        }
    }

    private func nutritionRow(_ name: String, unit: String, consumed: Double,
                              target: Double, remaining: Double) -> some View {
        HStack {
            Text(name).frame(width: 60, alignment: .leading)
            Text(String(format: "已摄入 %.0f / 目标 %.0f %@", consumed, target, unit))
            Spacer()
            Text(String(format: "剩余 %.0f %@", remaining, unit))
                .foregroundStyle(remaining < 0 ? Color.orange : Color.secondary)
        }
        .font(.callout)
    }

    private func addLog() {
        guard logAmount > 0, let food = store.data.foods.first(where: { $0.name == logFoodName }) else { return }
        let scale = logAmount / 100
        store.addDietLog(DietLog(date: .now, foodName: food.name, amountG: logAmount,
                                 foodId: food.id, kcal: food.kcalPer100g * scale,
                                 protein: food.proteinPer100g * scale, carb: food.carbPer100g * scale,
                                 fat: food.fatPer100g * scale, source: "manual"))
    }
}

// MARK: - 身体数据

struct BodyView: View {
    @EnvironmentObject var store: AppStore
    @State private var weight = 70.0
    @State private var bodyFat = ""
    @State private var waist = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("身体数据").font(.largeTitle.bold())
                if store.sortedMetrics.count > 1 {
                    Chart(store.sortedMetrics) { m in
                        LineMark(x: .value("日期", m.date), y: .value("体重", m.weightKG))
                        PointMark(x: .value("日期", m.date), y: .value("体重", m.weightKG))
                    }
                    .frame(height: 240)
                    .padding()
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.gray.opacity(0.08)))
                } else {
                    Text("至少录入 2 条体重数据后显示趋势图").foregroundStyle(.secondary)
                }
                GroupBox("录入今天") {
                    HStack(spacing: 12) {
                        TextField("体重(kg)", value: $weight, format: .number).frame(width: 120)
                        TextField("体脂%", text: $bodyFat).frame(width: 80)
                        TextField("腰围cm", text: $waist).frame(width: 100)
                        Button("添加") {
                            store.data.bodyMetrics.append(BodyMetric(date: .now, weightKG: weight,
                                bodyFatPct: Double(bodyFat), waistCM: Double(waist)))
                            store.save()
                            bodyFat = ""; waist = ""
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .padding(6)
                }
                GroupBox("历史记录") {
                    if store.sortedMetrics.isEmpty {
                        Text("暂无记录").foregroundStyle(.secondary).padding(6)
                    } else {
                        ForEach(store.sortedMetrics.reversed()) { m in
                            MetricRow(m: m)
                        }
                    }
                }
            }
            .padding(24)
        }
    }
}

struct MetricRow: View {
    let m: BodyMetric
    var body: some View {
        HStack {
            Text(m.date, style: .date).frame(width: 110, alignment: .leading)
            Text(String(format: "%.1f kg", m.weightKG)).frame(width: 90, alignment: .leading)
            if let f = m.bodyFatPct { Text(String(format: "体脂 %.1f%%", f)) }
            if let w = m.waistCM { Text(String(format: "腰围 %.0fcm", w)) }
            Spacer()
        }
        .font(.callout)
        .padding(.vertical, 2)
    }
}

// MARK: - 导入导出

struct ImportView: View {
    @EnvironmentObject var store: AppStore
    @State private var text = ""
    @State private var message = ""
    @State private var importing = false
    @State private var exportingJSON = false
    @State private var exportingICS = false
    @State private var exportDocument = TextDocument(text: "")
    @State private var backupPreview: BackupPreview?
    @State private var restoreMode: RestoreMode = .merge
    @State private var conflictPolicy: RestoreConflictPolicy = .local
    @State private var confirmingRestore = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("导入 / 导出").font(.largeTitle.bold())
                Text("历史数据上传接口：粘贴 CSV 或 JSON，或从文件导入。").foregroundStyle(.secondary)
                TextEditor(text: $text)
                    .frame(height: 180)
                    .font(.system(.body, design: .monospaced))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.gray.opacity(0.3)))
                    .onChange(of: text) { _ in backupPreview = nil }
                HStack(spacing: 12) {
                    Button("追加导入 JSON") { runJSON() }
                    Button("导入 CSV") { runCSV() }
                    Button("预览完整备份") { previewBackup() }
                    Button { importing = true } label: { Label("选择文件", systemImage: "folder") }
                    Spacer()
                    Button { prepareExport() } label: { Label("导出 JSON", systemImage: "square.and.arrow.up") }
                    Button { exportingICS = true } label: { Label("导出 .ics", systemImage: "calendar.badge.plus") }
                }
                if let preview = backupPreview {
                    GroupBox("完整备份预览 · schema v\(preview.schemaVersion)") {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(preview.fieldDescription("workouts", count: preview.data.workouts.count))
                            Text(preview.fieldDescription("plannedWorkouts", count: preview.data.plannedWorkouts.count))
                            Text(preview.fieldDescription("bodyMetrics", count: preview.data.bodyMetrics.count))
                            Text(preview.fieldDescription("foods", count: preview.data.foods.count))
                            Text(preview.fieldDescription("exercises", count: preview.data.exercises.count))
                            Text(preview.fieldDescription("dietLogs", count: preview.data.dietLogs.count))
                            Text(preview.fieldDescription("chat", count: preview.chat.count))
                            Picker("恢复模式", selection: $restoreMode) {
                                ForEach(RestoreMode.allCases) { Text($0.label).tag($0) }
                            }.pickerStyle(.segmented)
                            Picker("冲突策略", selection: $conflictPolicy) {
                                ForEach(RestoreConflictPolicy.allCases) { Text($0.label).tag($0) }
                            }.pickerStyle(.segmented)
                            if restoreMode == .replace {
                                Text("完整替换会以备份内容替换本地配置和所有集合。提交前会自动创建完整快照。")
                                    .foregroundStyle(.orange)
                            }
                            ForEach(preview.issues) { issue in
                                Text("• \(issue.description)")
                                    .font(.caption)
                                    .foregroundStyle(issue.blocking ? .red : .secondary)
                            }
                            Button("应用完整备份") { confirmingRestore = true }
                                .buttonStyle(.borderedProminent)
                                .disabled(!preview.canApply)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(6)
                    }
                }
                if !message.isEmpty { Text(message).font(.callout).foregroundStyle(.secondary) }
                Text(helpText)
                    .font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
            }
            .padding(24)
        }
        .fileImporter(isPresented: $importing,
                      allowedContentTypes: [.json, .commaSeparatedText, .plainText]) { res in
            if case .success(let url) = res, let content = try? String(contentsOf: url, encoding: .utf8) {
                text = content
                if url.pathExtension.lowercased() == "json" { previewBackup() } else { runCSV() }
            }
        }
        .confirmationDialog(restoreMode == .replace ? "确认完整替换？" : "确认合并备份？",
                            isPresented: $confirmingRestore, titleVisibility: .visible) {
            Button(restoreMode == .replace ? "完整替换" : "合并", role: restoreMode == .replace ? .destructive : nil) {
                applyBackup()
            }
            Button("取消", role: .cancel) { }
        } message: {
            Text("恢复前会自动备份当前数据；写入失败时会尽最大可能回滚。")
        }
        .fileExporter(isPresented: $exportingJSON,
                      document: exportDocument,
                      contentType: .json, defaultFilename: "fittrack-export.json") { result in
            if case .failure(let error) = result { message = "导出失败：\(error.localizedDescription)" }
        }
        .fileExporter(isPresented: $exportingICS,
                      document: TextDocument(text: ICSExporter.ics(for: upcoming(),
                                                                    bodyWeightKG: store.currentBodyWeightKG,
                                                                    heightCM: store.data.profile.heightCM)),
                      contentType: .plainText, defaultFilename: "训练计划.ics") { _ in }
    }

    private func upcoming() -> [PlannedWorkout] {
        store.data.plannedWorkouts.filter { $0.status == .planned }.sorted { $0.date < $1.date }
    }

    private func runJSON() {
        let r = Importer.importJSON(text, into: &store.data)
        if r.workouts > 0 || r.metrics > 0 { store.save() }
        var msg = r.message
        let addedChat = store.importChat(r.chat)
        if addedChat > 0 { msg += "，聊天记录新增 \(addedChat) 条" }
        message = msg
    }

    private func runCSV() {
        let r = Importer.importCSV(text, into: &store.data)
        message = r.message
        if r.workouts > 0 || r.metrics > 0 { store.save() }
    }

    private func previewBackup() {
        do {
            backupPreview = try BackupRecovery.parse(text)
            message = "备份解析完成，请检查预览、恢复模式和冲突策略。"
        } catch {
            backupPreview = nil
            message = "备份解析失败：\(error.localizedDescription)"
        }
    }

    private func applyBackup() {
        do {
            let preview = try BackupRecovery.parse(text)
            backupPreview = preview
            let candidate = try BackupRecovery.candidate(from: preview, local: store.data,
                                                         localChat: store.chatMessages,
                                                         mode: restoreMode, policy: conflictPolicy)
            let stats = try store.restore(candidate)
            message = "恢复完成：\(stats.summary)；问题 \(candidate.issues.count) 条"
            backupPreview = nil
        } catch {
            message = "恢复失败：\(error.localizedDescription)"
        }
    }

    private func prepareExport() {
        do {
            exportDocument = TextDocument(text: try store.exportJSON())
            exportingJSON = true
        } catch {
            message = "导出失败：\(error.localizedDescription)"
        }
    }

    private let helpText = """
    JSON 示例：
    {"version":"1.0","source":"manual","workouts":[{"date":"2026-09-10","split":"推","exercises":[{"name":"杠铃卧推","sets":[{"reps":8,"weight_kg":60}]}]}],"bodyMetrics":[{"date":"2026-09-10","weight_kg":72.5,"bodyFatPct":16}]}

    CSV 身体数据示例（表头）：date,weight_kg,body_fat_pct,waist_cm
    CSV 训练记录示例（表头）：date,exercise,reps,weight_kg
    """
}

// MARK: - 设置

struct ProfileView: View {
    @EnvironmentObject var store: AppStore
    @State private var apiKey = AICredentials.load() ?? ""
    @State private var hasKey = AIService.hasKey()
    @State private var newNote = ""
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("设置").font(.largeTitle.bold())
                GroupBox("个人资料") {
                    VStack(alignment: .leading, spacing: 12) {
                        Picker("性别", selection: $store.data.profile.sex) {
                            Text("男").tag("male")
                            Text("女").tag("female")
                        }
                        .frame(width: 220)
                        Stepper("年龄 \(store.data.profile.age)", value: $store.data.profile.age, in: 10...90)
                        HStack {
                            Text("身高(cm)")
                            TextField("", value: $store.data.profile.heightCM, format: .number).frame(width: 80)
                        }
                        Stepper("每周训练天数 \(store.data.profile.trainingDaysPerWeek)",
                                value: $store.data.profile.trainingDaysPerWeek, in: 1...7)
                        Picker("活动系数", selection: $store.data.profile.activityLevel) {
                            Text("1.2 久坐").tag(1.2)
                            Text("1.375 轻度活动").tag(1.375)
                            Text("1.55 中度活动").tag(1.55)
                            Text("1.725 高度活动").tag(1.725)
                            Text("1.9 极高活动").tag(1.9)
                        }
                        .frame(width: 260)
                    }
                    .padding(6)
                }
                GroupBox("目标") {
                    VStack(alignment: .leading, spacing: 12) {
                        Picker("目标类型", selection: $store.data.goal.type) {
                            ForEach(GoalType.allCases) { Text($0.label).tag($0) }
                        }
                        .frame(width: 220)
                        HStack {
                            Text("目标体重(kg)")
                            TextField("", value: $store.data.goal.targetWeightKG, format: .number).frame(width: 80)
                        }
                        HStack {
                            Text("每周增减(kg)")
                            TextField("", value: $store.data.goal.weeklyTargetDeltaKG, format: .number).frame(width: 80)
                        }
                    }
                    .padding(6)
                }
                GroupBox("三大项极限（1RM）") {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("给没有历史记录的动作配重时，按发力模式换算：推类看卧推、蹲类看深蹲、髋铰链看硬拉。留空则用训练历史自动估算。")
                            .font(.caption).foregroundStyle(.secondary)
                        HStack(spacing: 20) {
                            ForEach(BigThreeLift.allCases, id: \.self) { lift in
                                HStack(spacing: 6) {
                                    Text(lift.label)
                                    TextField("未填", text: bigThreeBinding(lift))
                                        .textFieldStyle(.roundedBorder)
                                        .frame(width: 72)
                                    Text("kg").foregroundStyle(.secondary)
                                }
                            }
                        }
                        HStack(spacing: 12) {
                            Button("用历史估算") { estimateBigThree() }
                                .disabled(store.data.workouts.isEmpty)
                            Text(historicalHint).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .padding(6)
                }
                GroupBox("训练偏好与约束") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("会长期注入 AI 上下文，影响训练计划的生成与对话建议。也可以在 AI 助手里聊出来，确认后再写入。")
                            .font(.caption).foregroundStyle(.secondary)
                        let notes = store.data.coachNotes ?? []
                        if notes.isEmpty {
                            Text("暂无").foregroundStyle(.secondary)
                        } else {
                            ForEach(Array(notes.enumerated()), id: \.offset) { pair in
                                HStack {
                                    Text("• \(pair.element)").font(.callout)
                                    Spacer()
                                    Button("删除") { removeNote(pair.offset) }
                                        .buttonStyle(.borderless).foregroundStyle(.red)
                                }
                            }
                        }
                        HStack {
                            TextField("例如：每周只能练 4 天，主项偏好低次数", text: $newNote)
                                .textFieldStyle(.roundedBorder)
                            Button("添加") { addNote() }
                                .disabled(newNote.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }
                    .padding(6)
                }
                GroupBox("AI 设置") {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("用于 AI 生成训练计划与 AI 助手对话（模型：DeepSeek）").font(.caption).foregroundStyle(.secondary)
                        HStack {
                            SecureField("DeepSeek API Key（sk-…）", text: $apiKey)
                                .textFieldStyle(.roundedBorder)
                            Button("保存") {
                                AICredentials.save(apiKey)
                                hasKey = AIService.hasKey()
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(apiKey.trimmingCharacters(in: .whitespaces).isEmpty)
                            if hasKey {
                                Button("清除") {
                                    AICredentials.delete()
                                    apiKey = ""
                                    hasKey = false
                                }
                            }
                        }
                        if !hasKey {
                            Text("未设置 API Key：训练计划将回退到固定模板，AI 助手不可用。").font(.caption).foregroundStyle(.orange)
                        } else {
                            Text("已配置 API Key").font(.caption).foregroundStyle(.green)
                        }
                    }
                    .padding(6)
                }
                Button("保存") { store.save() }.buttonStyle(.borderedProminent)
            }
            .padding(24)
        }
    }

    private func fmtNum(_ v: Double) -> String {
        v == v.rounded() ? String(format: "%.0f", v) : String(format: "%.1f", v)
    }

    private func bigThreeBinding(_ lift: BigThreeLift) -> Binding<String> {
        Binding(
            get: { lift.value(in: store.data.bigThree ?? BigThreeMax()).map { fmtNum($0) } ?? "" },
            set: { newValue in
                var m = store.data.bigThree ?? BigThreeMax()
                let trimmed = newValue.trimmingCharacters(in: .whitespaces)
                lift.set(trimmed.isEmpty ? nil : Double(trimmed), in: &m)
                store.data.bigThree = m.isEmpty ? nil : m
            }
        )
    }

    private func estimateBigThree() {
        let anchors = StrengthModel.historicalAnchors(workouts: store.data.workouts)
        guard !anchors.isEmpty else { return }
        store.data.bigThree = anchors
        store.save()
    }

    private var historicalHint: String {
        let anchors = StrengthModel.historicalAnchors(workouts: store.data.workouts)
        guard !anchors.isEmpty else { return "" }
        let parts = BigThreeLift.allCases.compactMap { lift -> String? in
            guard let v = lift.value(in: anchors) else { return nil }
            return "\(lift.label) \(fmtNum(v))kg"
        }
        return "历史估算：" + parts.joined(separator: " / ")
    }

    private func addNote() {
        let note = newNote.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !note.isEmpty else { return }
        var notes = store.data.coachNotes ?? []
        guard !notes.contains(note) else { newNote = ""; return }
        notes.append(note)
        store.data.coachNotes = notes
        newNote = ""
        store.save()
    }

    private func removeNote(_ index: Int) {
        guard var notes = store.data.coachNotes, notes.indices.contains(index) else { return }
        notes.remove(at: index)
        store.data.coachNotes = notes.isEmpty ? nil : notes
        store.save()
    }
}

// MARK: - FileDocument

struct TextDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.plainText, .json, .commaSeparatedText] }
    var text: String
    init(text: String = "") { self.text = text }
    init(configuration: ReadConfiguration) throws {
        if let data = configuration.file.regularFileContents {
            text = String(data: data, encoding: .utf8) ?? ""
        } else {
            text = ""
        }
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(text.utf8))
    }
}
