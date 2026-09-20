# FitTrack 网页版

Mac 版（`../Sources/FitTrack/`，SwiftUI）的网页移植，给用 Windows + 安卓的朋友用。
纯静态站点，部署在 GitHub Pages，**没有后端**：数据全在浏览器 localStorage 里，AI 由浏览器直连 DeepSeek（已实测其 CORS 预检会回显 Origin）。

## 怎么跑

```bash
cd /Users/frost/FitTrack/web
npm run dev        # http://localhost:5173/FitTrack/
npm test           # vitest，含与 Mac 版逐值比对的 oracle 测试
npm run build      # tsc -b && vite build
npm run deploy     # build + 推 dist 到 gh-pages 分支
```

网址：https://3148427574-cloud.github.io/FitTrack/

> 仓库是**整个 FitTrack 项目**（根目录 `/Users/frost/FitTrack`）：`Sources/` 是 Mac 版，
> `web/` 是网页版。两端放一个仓库是因为 `scripts/oracle/` 编译时要直接引用 Mac 源码
> （`../../Sources/FitTrack/Models.swift` 等），拆开 oracle 测试就断了。
>
> 部署走 `gh-pages` 分支（`gh-pages` 包），不用 GitHub Actions —— 账号的 token 没有
> `workflow` scope，推 workflow 文件会被拒。`vite.config.ts` 的 `base` 必须跟**仓库名**一致
> （`/FitTrack/`），不是目录名。

## 目录对应关系

每个 TS 文件对应 Mac 版一个 Swift 文件，改一边要想另一边：

| Swift | 网页版 |
|---|---|
| `Models.swift` | `src/models.ts` |
| `Engine.swift` | `src/engine.ts` |
| `AppStore.swift` | `src/store.ts` |
| `AIService.swift` | `src/ai.ts` |
| `Importer.swift` | `src/importer.ts` |
| `RemindersSync.swift` | `src/ics.ts`（只搬了 `WorkoutText` + `ICSExporter` 纯字符串部分） |
| `Views.swift` | `src/screens/*.tsx` + `src/components/*.tsx` |

`Views.swift` 里每个 View 的对应：

| Swift | 网页版 |
|---|---|
| `ContentView` | `src/App.tsx`（侧栏 + 页面切换） |
| `DashboardView` / `GoalProgressView` / `TodayPlanView` | `src/screens/Dashboard.tsx` |
| `TrainingView` / `AddLogView` | `src/screens/Training.tsx` |
| `AIChatView` / `ProposalCard` / `ChatBubble` | `src/screens/AIChat.tsx` + `src/components/Chat.tsx` |
| `DietView` | `src/screens/Diet.tsx` |
| `BodyView` / `MetricRow` | `src/screens/Body.tsx` + `src/components/MetricRow.tsx` |
| `ImportView` | `src/screens/ImportExport.tsx` |
| `ProfileView` | `src/screens/Settings.tsx` |
| `TextDocument` | `src/download.ts` |
| Swift Charts（`Chart`/`LineMark`/`PointMark`） | `src/components/LineChart.tsx`（内联 SVG） |
| `StatCard` / `GroupBox` / `confirmationDialog` / `.sheet` / `TextField` | `src/components/ui.tsx` |
| SF Symbols | `src/components/icons.tsx`（手写 16px 描边 SVG） |

## 验证方式：拿 Swift 版当 oracle

「网页版和 Mac 版算出来一样」是**机器验证**的，不是靠眼看。`scripts/oracle/` 下几个
Swift 命令行工具对固定输入打印期望值，存成 `src/__fixtures__/*.json`，vitest 断言 TS 逐值相等。

| oracle | 编译产物 | fixture | 测试 |
|---|---|---|---|
| `oracle/main.swift` | `/tmp/ftoracle` | `oracle.json` | `engine.test.ts` |
| `oracle/patch/main.swift` | `/tmp/ftpatch` | `patch.json` | `store.test.ts` |

```bash
cd scripts/oracle && swiftc -O -o /tmp/ftoracle \
  ../../Sources/FitTrack/Models.swift ../../Sources/FitTrack/Engine.swift \
  ../../Sources/FitTrack/RemindersSync.swift main.swift \
  && /tmp/ftoracle > ../../src/__fixtures__/oracle.json
```

**Swift 只在名为 `main.swift` 的文件里允许顶层语句**，所以每个 oracle 得各占一个目录。

### 导入导出格式要逐字节对齐

`scripts/oracle/roundtrip/main.swift` 把**真实的** `fittrack.json` 按 `AppStore.save()` 的配置
重编码一遍，人工比对网页版 `encodeJSON(decodeJSON(raw))` 的输出。已验过：32KB 真实数据逐字节一致。
（不进 vitest —— 依赖本机真实用户数据，不能进仓库；`models.test.ts` 用合成数据钉住同样的规则。）

`models.ts` 的 `encodeJSON` 是手写序列化器，因为 JSON.stringify 跟 Foundation 差三处，都踩过：

1. 键顺序：Swift `.sortedKeys` 排过，stringify 按插入序。
2. `"key" : value` —— Foundation 冒号前有空格。
3. 空数组/空对象：Foundation 写成 `[\n\n  ]`，JS 写 `[]`。

外加两条：Foundation 把 `/` 转义成 `\/`；Swift 合成 Codable 对 Optional 用 `encodeIfPresent`，
**nil 字段整个键都不写**（不是写 null）。这个 schema 里可空字段都是 Swift Optional，所以
「值为 null/undefined 就丢掉」正好对。

### 数值格式化的坑

`String(format: "%.Nf")` 的 `.5` 是**就近取偶**（182.5 → `"182"`），JS 的 `toFixed` 是就近远离零
（→ `"183"`）。身高 182.5cm 正好踩中，被 oracle 测试当场抓到。所以 `engine.ts` 的
`fmt0/fmt1/fmt2` 走自写的 `printfFixed`（BigInt 取精确十进制值再就近取偶），**不要改回 toFixed**。

## 与 Mac 版的差异（有意为之）

- **没有「同步到提醒事项」**：EventKit 是苹果独有。训练页只保留「导出 .ics」，去掉同步与刷新状态。
- API Key 存 localStorage（浏览器没有 Keychain 等价物）。
- 文件选择/保存走 `<input type="file">` 与 Blob 下载。
- 加载 localStorage 时**逐字段补默认值**（`store.ts` 的 `normalizeData`），比 Mac 版 Codable
  「缺一个非 optional 字段就整份解码失败退回空数据」更宽容 —— 备份文件坏一个字段不该丢全部。
- **数据改动即时落盘**：Mac 版页面直接改 `store.data` 再手动 `store.save()`，网页版数据不可变，
  页面统一走 `store.ts` 的 12 个 mutation 方法（`updateProfile` / `addWorkout` / …），
  由 `commit` 负责「换引用 → 通知 → 落盘」。所以设置页没有页脚的「保存」按钮（改动已经生效了）。
- **AI 载荷逐字段降级**：Swift 用 `JSONDecoder().decode` 整包解，任一字段类型不对就丢掉整包；
  网页版 `decodePayload` 坏字段忽略、其余照常应用（每个字段本来就要过夹紧）。
- **日期文案用 `toLocaleDateString('zh-CN')`**：代替 Swift 的 `.formatted(date: .date)` /
  `.formatted(date: .numeric)`（AI 上下文里的「今天日期」）。两边显示格式可能有细微出入，
  但不参与任何计算，也不进导出文件。
- `Importer` 在 TS 里没有 `inout`，所以 `importJSON` / `importCSV` 返回 `{ result, data }`，
  页面把 `data` 交给 `store.replaceData()`。
- Swift Charts → 手写内联 SVG（`LineChart.tsx`）；SF Symbols → 手写描边 SVG（`icons.tsx`）。

### 一个踩过的坑：读回来必须还原日期

`store.ts` 的 `safeParse` 一定得走 `decodeJSON`（带 `reviveDates`），**不能用裸 `JSON.parse`**。
否则从 localStorage 读回来的 `date` 是 ISO 字符串，`store.sortedMetrics` 里
`.sort((a, b) => a.date.getTime() - b.date.getTime())` 直接抛
`TypeError: a.date.getTime is not a function` —— 刷新页面后概览页整页空白。
`store.test.ts` 的「落盘往返」用 `encodeJSON` → `decodeJSON` 钉住这条。

## 当前进度

功能已全部落地，`npm test` 244 项全绿，`npm run build` 通过，dev server 逐页验收过。

- ✅ 脚手架（Vite + React + TS + PWA）、`models.ts`、`engine.ts`、`ics.ts`、`store.ts`
- ✅ oracle 验证：`engine.test.ts` 183 项 + `models.test.ts` 14 项 + `store.test.ts` 47 项
  （45 个 `plannedChanges` 边界场景逐值对齐 Swift + 1 项落盘往返）
- ✅ `ai.ts`（prompt 逐字复制 + `<<<UPDATES>>>` 哨兵协议）、`importer.ts`（`weight_kg`/`weightKG` 双兼容）
- ✅ 侧栏 + 7 个页面：概览 / 训练 / 饮食 / 身体 / AI 助手 / 导入导出 / 设置
- ✅ PWA 图标 `public/icon-192.png`、`icon-512.png`、`apple-touch-icon.png`
  （用 `qlmanage` 栅格化 `favicon.svg` 再用 PIL 居中贴到 `#111417` 底上，图形占 62% 落在 maskable 安全区）
- ⬜ `npm run deploy` 没跑：`/Users/frost/FitTrack` 下没有 `.git`，gh-pages 流程起不来

## 下一步

1. `git init` + 关联 GitHub 仓库，然后 `npm run deploy`，按计划里的 `gh api` 打开 Pages。
2. 用 Mac 版导出的真实 `fittrack.json` 走一遍导入导出，确认 `weightKG` 兼容（`Importer.pickWeight`
   优先读 `weight_kg`，同时认 `weightKG`）。
