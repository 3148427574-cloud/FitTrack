# FitTrack

个人健身与体重管理应用（SwiftUI，macOS + iOS 双 target）。核心：根据训练历史与身体数据变化生成每日训练计划（AI 辅助）、增肌饮食计划、身体指标记录、同步 Apple「提醒事项」、历史数据导入。

## 怎么跑

构建用 xcodegen + xcodebuild（`Package.swift` 是早期 SPM 遗留，已不用）。

```bash
cd /Users/frost/FitTrack
xcodegen generate
xcodebuild -project FitTrack.xcodeproj -scheme FitTrack -configuration Debug build
# iOS（未实机运行）：
# xcodebuild -project FitTrack.xcodeproj -scheme FitTrack-iOS -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO
```

安装并启动：把 DerivedData 里的 `FitTrack.app` 拷到 `/Applications/FitTrack.app` 后 `open`。

打包分享给朋友（ad-hoc 签名 + 通用二进制 + DMG，产物在 `dist/FitTrack.dmg`）：

```bash
./scripts/package.sh
```

## 技术栈

- SwiftUI + AppKit（macOS）；iOS 双 target，deployment macOS 14 / iOS 17。
- 存储：JSON 文件（非 SwiftData）——`~/Library/Application Support/FitTrack/fittrack.json`（主数据）+ `chat.json`（AI 聊天历史）。
- AI：DeepSeek `chat/completions`（模型 `deepseek-chat`），原始 URLSession；key 存 Keychain。
- EventKit 读写「提醒事项」（双向完成同步）；HealthKit 仅 iOS 预留。

## 目录与约定

- `Sources/FitTrack/` 全部源码：Models / AppStore / Engine / Importer / RemindersSync / AIService / FitTrackApp / Views；`scripts/package.sh` 出 DMG。
- macOS bundle id `com.frost.fittrack`（ad-hoc 签名）；iOS `com.frost.fittrack.ios`。
- 坑：给 Codable 结构体加字段必须用 optional，否则旧 JSON 整体解码失败丢数据。
- 文档：`docs/开发文档.md` 是常驻技术文档（架构/数据模型/核心机制详解）；`docs/使用手册.md` 面向使用者（两个版本怎么用、导入格式、算法口径、FAQ）；`docs/2026-09-16-开发总结.md` 为某次会话快照。

## 配重与卡路里的口径（改之前先读）

- 配重优先级链在 `StrengthModel.prescribedWeight`：本动作近 30 天 1RM → 三大项锚点 × `anchorRatios` 系数 → 体重比例兜底。目标重量 = 1RM × `intensity(forReps:)`（Epley 逆运算），四舍五入到 2.5kg。
- 三大项锚点 = 手填（`AppData.bigThree`）优先，缺项用历史 Epley 估算补齐。系数表里三大项自身是 1.0，漏掉它们会让卧推被当成辅项而配重腰斩（踩过）。
- 卡路里 = MET 基线 × 身高行程修正 `CalorieEstimator.heightFactor`，修正系数夹在 ±8%。这是启发式模型不是实测，UI 会显示系数以便用户判断；MET 基线本身不随重量变化，这是已知的粗估。

## 当前状态与下一步

- 已实现：概览/训练/饮食/身体/导入导出/AI 助手/设置；AI 生成计划 + AI 聊天（历史持久化）；按三大项与历史配重 + 身高行程修正的卡路里估算；提醒双向完成同步；历史训练一键/逐条删除。
- 同步到「提醒事项」和导出 .ics 的动作行带重量与卡路里，文案统一走 `RemindersSync.swift` 的 `WorkoutText`，口径与 App 内 `PlanCard` 必须一致（改一处要改两处）。
- 导出 JSON = `AppData` 原样展开 + 顶层 `chat` 键（聊天历史）。导入侧 `ImportSet` / `ImportBodyMetric` 同时接受 `weight_kg` 与 `weightKG`，所以 App 自己导出的文件能原样导回来。踩过：导出写的是驼峰 `weightKG`，导入 schema 要 `weight_kg`，两者对不上让「导出 JSON」产出的备份根本导不回来，直到 2026-09-20 才发现。
- AI 可提议修改个人资料与今日计划：回复末尾附 `<<<UPDATES>>>{...}<<<END>>>` 块（`plan` 字段是今日计划的「完整动作列表」，整体替换；聊天上下文里会注入今日计划供模型对齐），`AIService.splitProposal` 解析剥离，聊天里渲染成确认卡片，用户点「应用」才经 `AppStore.plannedChanges` 校验夹紧后写入。绝不自动改。
- 网页版独有的两处交互（Mac 版没有）：`GeneratePlanButton` 先选部位（胸/背/腿/自定义，`TrainingPlanner.focusedTemplate` / `customTemplate`）再生成；`PlanCard` 带「编辑」面板，可直接改今日计划的名称、动作、组次与重量（`AppStore.updatePlannedWorkout`）。
- iOS target 能编过（`-scheme FitTrack-iOS -sdk iphonesimulator`，AppKit 代码有 `#if os(macOS)` 守卫），但从未在真机/模拟器跑过，也没有任何分发路径 —— 分发给朋友只有 macOS 版走 DMG。
- 下一步候选：iOS 真机跑起来 + HealthKit 读体重；导入支持恢复 `profile`/`goal`/`bigThree`/`coachNotes`/`plannedWorkouts`（当前只恢复 workouts + bodyMetrics + chat，导出是完整备份但导入只覆盖这几类）。
