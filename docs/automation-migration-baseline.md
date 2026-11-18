# B0：OpenCode Schedule → Automation API 迁移基线核查

> 批次性质：**只读核查**，不修改生产代码、不改依赖/版本/锁文件、不合并、不打 Tag、不发布。
> 核查日期：2026-11-18
> 核查对象仓库：`meiyx7/opencode-schedule-center`，本地 checkout `main @ 64e6125b402ea89041a4a8354e1165414ca71d87`
> 官方源码基线：`anomalyco/opencode @ a0fdbf9b91ed2cf8bfd778ccec340285403eddc2`（稀疏拉取 + raw 读取）
> 官方 SDK 基线：`@opencode/client`、`@opencode/plugin`、`@opencode/schema` **均 2.3.2**（npm registry 实测）

---

## 0. 结论摘要（先读这一段）

1. 报错根因已确认：`client.experimental.schedule` **整个命名空间在 2.3.2 被删除**，改名为 `client.experimental.automation`。插件 `src/store.ts` 中 7 处 `this.client.experimental.schedule.*` 调用在运行时拿到 `undefined`，读 `.list` 即抛 `Cannot read properties of undefined (reading 'list')`。
2. 这不是插件升级引入的回归：0.1.15 → 0.1.17 的 `.list()` 调用点完全一致；也**不是 GUI API 变化**——`ctx.servers.list()` 所在的 `gui/context.d.ts` 在 2.2.5 与 2.3.2 接口完全一致（仅注释变动）。
3. 新旧 API **不是简单改名**：trigger 结构基本可映射，但 `if`/`until` 条件门禁与 `ends.times` 次数限制在 Automation 中**没有对应字段**；官方数据库迁移会**直接丢弃**这类旧任务。
4. `Automation.list` 的查询边界与旧的 `schedule.list({sessionID})` 完全不同：新接口**两个参数都可选，不传即返回全库所有可见 automation**，无需遍历 session。这是本次迁移中最有利的一点。
5. 官方迁移是**数据库层的、自动的、不可逆的**（`DROP TABLE schedule`）。插件侧必须先完成 API 迁移，否则在已升级的宿主上会持续崩溃。

### 迁移职责边界（B1 修订／明确）

> 本小节为 B1 修订：**插件不承担任何数据迁移职责**。数据迁移全部由 OpenCode 宿主在数据库层自动完成，插件只做 Automation 的前台管理。

- **插件负责**：以官方 Automation API 呈现、创建、暂停、恢复、删除 Automation；只读写自己通过 API 拿到的 `AutomationInfo`，调度、执行、状态机与持久化一律复用官方能力。
- **插件不负责，且严禁**：
  - 调用 `migration.v1.status()` 或任何 migration 接口；
  - 读取、修改、迁移 OpenCode 数据库；
  - 扫描旧 Schedule 并自动重建 Automation；
  - 实现新旧 API 双兼容；
  - 自建调度器、轮询器、执行引擎或状态机。
- 因此第 7.1 节的官方迁移规则、**7.2 节被丢弃的任务清单仅作风险告知**：插件不会尝试恢复被宿主丢弃的带 `if`/`until`/`ends.times` 的任务，也不会把它们重建为 Automation。这类数据若需保留，须由用户/宿主侧处理，不属于本插件范围。
- 后果：旧功能中 `if`/`until`（条件门禁）、`ends.times`（运行次数上限）、`remainingRuns`、`lastOutcome = "checked"` 在插件中**没有官方对应能力**，属新 API 不再支持的功能（见第 6.3 节），B1 起不再向官方入参注入这些字段。

---

## 1. 官方版本基线

| 项目 | 核实值 | 依据 |
|---|---|---|
| 官方仓库 | `anomalyco/opencode` | GitHub WebFetch 核实为 canonical repo |
| 官方源码 commit | `a0fdbf9b91ed2cf8bfd778ccec340285403eddc2` | `git rev-parse HEAD` |
| npm `@opencode/client` | **2.3.2** | `npm view @opencode/client version` |
| npm `@opencode/plugin` | **2.3.2** | `npm view @opencode/plugin version` |
| npm `@opencode/schema` | **2.3.2** | `npm view @opencode/schema version` |
| 本机 Desktop 实际运行 CLI | **2.3.2**（`~/Library/Application Support/ai.opencode.desktop/cli/2.3.2-arm64`，2026-11-18 14:13 安装） | 文件系统 + 进程核实 |
| GitHub `releases/latest` tag | `v1.19.6` | `api.github.com/repos/anomalyco/opencode/releases/latest` |
| 旧插件依赖 | `@opencode/plugin 2.2.5` | 本仓库 `package.json` |

**版本体系说明（重要）**：GitHub release tag（`v1.19.x`）与 npm `@opencode/*` 包版本（2.x）是两套轨道。API 兼容性判断**以 npm 包版本 + Desktop CLI 版本为准**，二者一致为 2.3.2。

**关键端点实测**（对 2.3.2 CLI 二进制做 `strings` 计数）：

| 端点 | 2.3.2 中出现次数 |
|---|---|
| `/api/experimental/schedule` | **0**（已删除） |
| `/api/experimental/automation` | 7（create/list/get/pause/resume/delete + 内部） |
| `/api/experimental/` 全命名空间 | 65（experimental 整体仍在） |

官方原文线索（`strings` 提取）：
- `Deprecated: use experimental.automations` —— 旧 `experimental.schedules` 配置开关已废弃
- `Automations are disabled; set experimental.automations in config`
- `Event automations require experimental.mcp_events`

来源：
- https://www.npmjs.com/package/@opencode/client/v/2.3.2
- https://www.npmjs.com/package/@opencode/schema/v/2.3.2
- https://github.com/anomalyco/opencode/tree/a0fdbf9b91ed2cf8bfd778ccec340285403eddc2

---

## 2. 官方接口及类型清单

### 2.1 权威类型出处

任务点名的 `Automation.Info` / `Automation.CreatePayload` / `Automation.Target` 等，来自 `@opencode/schema@2.3.2` 的 `dist/automation.d.ts`（由 `dist/effect/api/api.d.ts` 中 `import * as Automation from "@opencode/schema/automation"` 引入）。

本地核查副本：`/tmp/opencode-baseline-b0/schema/package/dist/automation.d.ts`（**全文 384 行已完整读取**）。
对应官方源码：https://github.com/anomalyco/opencode/blob/a0fdbf9b91ed2cf8bfd778ccec340285403eddc2/packages/core/src/automation.ts

> 注意：`Automation.CreatePayload` 是 protocol/groups 层的名字；SDK 暴露的等价类型是 `ExperimentalAutomationCreateInput`。两者字段一致，下文以 SDK 类型为准并标注对应关系。

### 2.2 完整类型清单（均出自 schema 2.3.2 automation.d.ts）

| 任务要求类型 | schema 中的定义 | 关键内容 |
|---|---|---|
| `Automation.Info` | `Info`（L157-222） | 见 2.3 字段表 |
| `Automation.CreatePayload` | `CreateInput`（L329-383）/ `ExperimentalAutomationCreateInput`（SDK types.d.ts L5646） | `name`(必填), `trigger`, `action`, `expires?`, `sessionID?`, `directory?` |
| `Automation.Trigger` | `Trigger`（L42-60） | `At \| Every \| Cron \| Event` 四选一 |
| `Automation.Action` | `Action`（L135-152） | `PromptAction \| CodeAction` |
| `Automation.ActionInput` | `ActionInput`（L253-278） | `PromptActionInput \| CodeActionInput` |
| `Automation.PromptActionInput` | `PromptActionInput`（L223-245） | `{ type:"prompt", prompt, to?: Target }` —— **`to` 可选** |
| `Automation.CodeActionInput` | `CodeActionInput`（L246-252） | `{ type:"code", code, args? }` |
| `Automation.Target` | `Target`（L61-71） | **见 2.4 完整定义** |
| `Automation.Status` | `Status`（L153-154） | `"active" \| "paused" \| "done"` |
| `Automation.Outcome` | `Outcome`（L155-156） | `"fired" \| "late" \| "skipped" \| "disabled" \| "failed" \| "expired"`（**无 `checked`**） |

其他关键类型：
- `At`: `{ type:"at", at:string, tz?:string }`（L12-19）
- `Every`: `{ type:"every", every:string, tz?:string }`（L20-26）
- `Cron`: `{ type:"cron", cron:string, tz?:string }`（L27-33）
- `Event`: `{ type:"event", server:string, event:string, args?:Record<string,Json> }`（L34-41）
- `PromptAction`: `{ type:"prompt", prompt, to: Target }`（L76-90，**`to` 必填**）
- `CodeAction`: `{ type:"code", code, args? }`（L128-134）
- `CodeResult`: `{ state?, done?, send?: { prompt, to?: { subagent } } }`（L91-122）
- `Request`: `{ name, trigger, action, expires? }`（L279-328）

### 2.3 `Automation.Info` 完整字段（schema L157-220）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `Automation.ID` | branded string |
| `name` | `string` | 必填（旧版可选） |
| `projectID` | `Project.ID` | 创建时归属项目 |
| `sessionID?` | `SessionID` | 创建它的 Session；**删除该 Session 不会删除 automation**（L165 注释） |
| `directory` | `string` | 所在目录，决定配置开关归属 |
| `trigger` | `Trigger` | at/every/cron/event |
| `tz` | `string` | 时区（已解析，非可选） |
| `action` | `Action` | prompt/code（已解析，`to` 必填） |
| `expires?` | `DateTimeUtc` | **停止重复的绝对时间点** |
| `status` | `Status` | active/paused/done |
| `nextDueAt?` | `DateTimeUtc` | 下次触发时间 |
| `runCount` | `int` | 已运行次数 |
| `lastRunAt?` | `DateTimeUtc` | |
| `lastOutcome?` | `Outcome` | |
| `lastOutput?` | `string` | |
| `state?` | `Json` | code action 的持久化状态 |
| `time` | `{ created, updated }` | `DateTimeUtc` |

### 2.4 `Automation.Target` 完整定义（**按要求逐字核对，非文档摘要**）

schema L61-71 原文（去重后）：

```ts
export declare const Target: Schema.Union<readonly [
  Schema.Struct<{
    readonly session: SessionID                  // branded "SessionID"
    readonly subagent: Schema.optionalKey<Schema.Never>
  }>,
  Schema.Struct<{
    readonly subagent: Schema.brand<Schema.String, "Agent.ID">
    readonly session: Schema.optionalKey<Schema.Never>
  }>
]>
```

**关键结论**（极易误解，必须写进实现约束）：
- 只有两种互斥形态：`{ session: "ses_..." }` 或 `{ subagent: "agent-id" }`，**用 `optionalKey<Never>` 在类型层禁止同时出现**。
- **没有 `directory` 字段**，也没有 `agent + session` 组合。
- `{ subagent }` 语义：每次运行都从**创建者的 Session** 派生一个子 Session（`runSessionID(id, run)`，L72-75），该子会话**结束时不上报、也不唤醒父会话**（`isRunSession`，L74-75）。
- `{ session }` 语义：发往指定 Session；跨 project 的 Session 会被拒绝（见 2.6）。
- 官方命令文档补充（`automation.txt` L11）：不写 `to` 时默认发往**当前 Session**；`{to:{subagent:"<agent>"}}` 每次起一个不回报的子会话；`{to:{session:"ses_..."}}` 指向另一个 session。

### 2.5 六个接口的 SDK 调用方式（`@opencode/client@2.3.2` dist/promise/client.d.ts L99-106）

```ts
client.experimental.automation.create(input: ExperimentalAutomationCreateInput)   // Promise<AutomationInfo>
client.experimental.automation.list(input?: ExperimentalAutomationListInput)     // Promise<AutomationInfo[]>
client.experimental.automation.get(input: { automationID: string })               // Promise<AutomationInfo>
client.experimental.automation.pause(input: { automationID: string })             // Promise<AutomationInfo>
client.experimental.automation.resume(input: { automationID: string })            // Promise<AutomationInfo>
client.experimental.automation.delete(input: { automationID: string })            // Promise<void>
```

Input 定义（types.d.ts L5690-5718）：
- `ListInput`: `{ sessionID?: string, directory?: string }` —— **均可选**
- `Get/Pause/Resume/DeleteInput`: `{ automationID: string }`

### 2.6 六接口逐项核实表

| 接口 | 参数结构 | 返回 | 错误类型 | 查询范围 | 需 Session | 需 Directory | 开关 |
|---|---|---|---|---|---|---|---|
| `list` | `{sessionID?,directory?}`，**整个 input 可省略** | `AutomationInfo[]`，按创建时间+id 升序（core L1087-1092） | `InvalidRequestError`（directory 非绝对路径）、`AutomationNotFoundError`/`Session.NotFoundError`（sessionID 不存在时，handler L54） | 见第 4 节 | 否 | 否 | 对每条结果的 directory 逐条判定；**目录已消失的记录仍可见**（handler L21-23） |
| `create` | `{name(必填), trigger, action, expires?, sessionID?, directory?}` | `AutomationInfo` | `Automation.InvalidError` / `Automation.DisabledError` / `Session.NotFoundError` / `Permission.BlockedError` / `Permission.CorrectedError`（handler L40-47） | 新建 | 否（但 code action / subagent target / event trigger 需要，见 5.4） | 否（缺省顺序：owner session 的 directory → `input.directory` → `os.homedir()`，core L1001） | `experimental.automations` 必须开（core L1008）；event 还需 `experimental.mcp_events` |
| `get` | `{automationID}` | `AutomationInfo` | `AutomationNotFoundError` | 单条 | 否 | 否（从记录自身 directory 判定） | 该记录 directory 的 flag（handler L27-32） |
| `pause` | `{automationID}` | `AutomationInfo` | `AutomationNotFoundError` | 单条 | 否 | 否 | 同上（handler L79-83） |
| `resume` | `{automationID}` | `AutomationInfo` | `AutomationNotFoundError` | 单条 | 否 | 否 | 同上（handler L84-88） |
| `delete` | `{automationID}` | `void` | `AutomationNotFoundError` | 单条 | 否 | 否 | 同上（handler L89-93） |

错误类型权威定义（`packages/core/src/automation.ts` L68-88）：
- `Automation.NotFoundError` — `{ automationID }`
- `Automation.InvalidError` — `{ reason: string }`
- `Automation.DisabledError` — message: `Automations are disabled; set experimental.automations in config`

API 层映射（`server-handler-automation.ts` L41-47）：Invalid→`InvalidRequestError(kind:"automation")`，Disabled→`ForbiddenError`，Permission→`ForbiddenError`，Session 缺失→`missingSession`。

### 2.7 实验开关及配置作用域（任务二第 6 点）

| 开关 | 作用域 | 作用 | 依据 |
|---|---|---|---|
| `experimental.automations` | **按 directory 各自的 config 解析**（core L293-301 `settings(directory)`） | 所有 automation 路由的准入开关；旧 `experimental.schedules` 已废弃 | core L1008、handler L19-25、DisabledError message |
| `experimental.mcp_events` | 同上 | 仅 event trigger 需要；缺失时报 `Event automations require experimental.mcp_events` | core L1013 |

关键实现细节（core L293-301）：`settings(directory)` 从该目录的解析配置取 `automations.enabled` 与 `mcp_events.enabled`。**不是全局开关**，因此"项目 A 开了、项目 B 没开"时，跨项目枚举会按每条记录的 directory 分别过滤。

**Event Trigger 的授权与创建方式**（core L1011-1030，官方命令文档 L9-10）：
- 必须满足：`experimental.mcp_events` 开启 + 有 owner session + 有 tool invocation + owner 是 local session（`workspaceID === undefined`）；否则报 `Create an event automation from a tool call in a local session`。
- 必须用 session 当前 agent 创建（`matchesAuthor`），并需权限断言 `opencode_watch_mcp_event`，资源为 trigger.server。
- event 触发需 MCP server 支持 push delivery；`args` 必须匹配 `inputSchema`。
- **推论（需在 B 批产品决策中确认）**：这是一条"从工具调用中创建"的路径，GUI 表单直接走 `client.experimental.automation.create()` 没有 invocation，因此**GUI 侧不能可靠创建 event automation**——应标记为"新 API 不再支持 / 需产品决策"，而不是假装可以。

---

## 3. 新旧接口映射表

| 旧（2.2.5 `experimental.schedule`） | 新（2.3.2 `experimental.automation`） | 迁移性质 |
|---|---|---|
| `schedule.create(input)` sessionID 必填 | `automation.create(input)` sessionID 可选、新增 directory | 需改业务逻辑 |
| `schedule.list({sessionID})` sessionID 必填 | `automation.list(input?)` 两参均可选 | **可直接迁移且大幅简化**（见第 4 节） |
| `schedule.get({scheduleID})` | `automation.get({automationID})` | 直接迁移（改名 + ID 前缀 `sch_`→`aut_`） |
| `schedule.pause({scheduleID})` | `automation.pause({automationID})` | 直接迁移 |
| `schedule.resume({scheduleID})` | `automation.resume({automationID})` | 直接迁移 |
| `schedule.delete({scheduleID})` | `automation.delete({automationID})` | 直接迁移 |
| `ScheduleInfo` | `AutomationInfo` | 字段差异见第 4 节 |
| `experimental.schedules` 配置开关 | `experimental.automations` | 需改文档/提示文案 |

旧代码调用点（本仓库 `src/store.ts`，基于 commit 64e6125）：L57 `session.list`、L102/331 `schedule.list`、L241 `session.create`、L257 `session.switchModel`、L279 `session.switchAgent`、L298 `schedule.create`、L359 `session.remove`、L412 `pause`、L417 `resume`、L427 `delete`、L442 `get`。共 **7 处 schedule 调用 + 5 处 session 调用**。

GUI API（`src/gui.tsx`、`src/gui/form.tsx`）：`ctx.dialogs` / `ctx.add(SettingsPage|TitlebarItem|Command)` / `ctx.ui` / `ctx.servers.list()` / `ctx.tabs.open()` —— **2.2.5 与 2.3.2 完全一致，无需改动**（`diff gui/context.d.ts` 仅注释差异）。

---

## 4. 新旧字段差异表

| 旧字段（2.2.5 `ScheduleInfo` / CreateInput） | 新字段（2.3.2 `AutomationInfo` / CreateInput） | 差异与风险 |
|---|---|---|
| `id: ScheduleID` | `id: Automation.ID` | 迁移脚本把 `sch_...` 变成 `aut_...`（`'aut_' \|\| substr(s.id,5)`） |
| `name?` | `name`（必填） | 旧可空；迁移时用 prompt 前 60 字符兜底（migration L54） |
| `sessionID?` | `sessionID?` | 名称相同；删除 Session 不删除 automation |
| — | `projectID`（新增） | 新数据模型的项目归属 |
| — | `directory`（Info 新增） | 决定配置开关归属与 list 过滤 |
| `when: {type:"in", in, tz?}` | `trigger: {type:"at", at:<绝对ISO>, tz?}` | **官方迁移把 `in` 折算成绝对时间**（migration L56）；直接迁移表单的 `in` 则在 create 时由 `firstDue` 解析 |
| `when: at / every / cron` | `trigger: at / every / cron` | 结构基本同名（`tz` 位置一致）；`every`/`cron` 直接映射 |
| — | `trigger: {type:"event", server, event, args?}` | **新能力**，旧无对应；受 mcp_events + tool-call 约束 |
| `action: {type:"prompt", prompt}` | `action: {type:"prompt", prompt, to: Target}` | 新必填 `to`；Input 层可省（默认当前 session），Info 层必有 |
| — | `action: {type:"code", code, args?}` | **新能力**，旧无对应 |
| `if?: ScheduleCondition`（shell/code） | **无对应字段** | ⚠️ **新 API 不再支持**；官方迁移丢弃此类任务 |
| `until?: ScheduleCondition`（shell/code） | **无对应字段** | ⚠️ **新 API 不再支持**；官方迁移丢弃此类任务 |
| `ends?: { after?, at?, times? }` | `expires?: string`（单一绝对时间） | ⚠️ **不能视为等价**：`after`/`at` 可折算为 `expires`；`times`（次数限制）**无对应**，官方迁移丢弃（详见 5.3） |
| `remainingRuns?` | **无对应字段** | ⚠️ 次数限制能力消失 |
| `nextDueAt?: number` | `nextDueAt?: DateTimeUtc` | 类型从 epoch 毫秒变为 DateTimeUtc（UI 展示需适配） |
| `endsAt?: number` | `expires?: DateTimeUtc` | 字段映射但语义不同（见 5.3） |
| `runCount` | `runCount` | 同名 |
| `lastFiredAt?` | `lastRunAt?` | 改名 |
| `lastOutcome?: ScheduleOutcome` | `lastOutcome?: Outcome` | 枚举变化：旧 `checked` 被移除；新增 `expired` 保留；两者都有 fired/late/skipped/disabled/failed |
| `lastOutput?` | `lastOutput?` | 同名 |
| — | `state?` | 新：code action 的持久化 JSON |
| `time: {created,updated}: number` | `time: {created,updated}: DateTimeUtc` | 类型变化 |

旧类型依据：`@opencode/client@2.2.5` `types.d.ts` L471-497、L1229-1239、L3028、L3569-3588、L5443-5502（本地缓存副本）。
新类型依据：`@opencode/schema@2.3.2` `automation.d.ts`（全文）。

---

## 5. 数据读取与查询范围方案

### 5.1 `automation.list` 不传参数时的实际行为（任务三特别要求）

权威依据：`packages/server/src/handlers/automation.ts` L49-77（已逐行读取）。

执行顺序：
1. `query.sessionID` 为空 → 跳过 session 解析与校验。
2. `query.directory` 为空 → 跳过绝对路径校验、跳过 `allowed(directory)`、跳过 project 解析（`projectID = undefined`）。
3. 调用核心 `automations.list({ sessionID: query.sessionID })` —— 核心层（`automation.ts` L1082-1095）按 `session_id` 和 `project_id` 做 AND 过滤；**handler 没有传 projectID**，所以核心返回**全库所有 automation**。
4. 内存过滤：`directory === undefined || row.projectID === projectID || row.directory === directory` —— 不传 directory 时**全部通过**。
5. 可见性过滤：对结果中所有出现过的 directory 逐一调用 `enabled(directory)`，只保留开光的记录。目录已被删除的仍视为可见（L21-23），便于检查与删除。
6. 结果按 `time_created, id` 升序返回。

**结论**：`await client.experimental.automation.list()`（零参数）即可**完整枚举当前用户可见的全部 Automation**，不需要像旧版那样先 `session.list()` 再按 session 分块 `schedule.list()`（旧 `store.ts` L57 + L102 的扫描协调器可以整体删除）。唯一约束是每条记录所在目录的配置开关是否开启。

### 5.2 三种过滤的 AND 关系

| sessionID | directory | 效果 |
|---|---|---|
| 省略 | 省略 | 全库（受逐条开关可见性约束） |
| 指定 | 省略 | 该 Session 创建的全部 automation |
| 省略 | 指定（绝对路径） | 该 project 或该 directory 的全部 automation |
| 指定 | 指定 | 交集 |

注意：传 `sessionID` 时会先 `sessions.get()` 校验存在性，不存在抛 `Session.NotFoundError`；传相对路径的 `directory` 抛 `InvalidRequestError`。

### 5.3 `ends` 与 `expires` 的准确语义（**不得等价处理**）

权威依据：
- 核心 `finished()` / `expired()`（`automation.ts` L196-197）：
  ```ts
  const finished = (row, next) => next === undefined || (row.expires_at !== null && next > row.expires_at)
  const expired  = (row, now)  => row.expires_at !== null && now > row.expires_at
  ```
- create 校验（core L1042-1048）：若首次运行时间晚于 expires，则报 `The automation expires before it first runs`。
- 官方命令文档 L14：`expires` 是"让重复任务在某个时间点停止"的时间点。

语义要点：
- `expires` 是**重复的截止界线**：下一次触发时间超过它时任务转为 `done`（`finished`），不是"到点强制中断已开始的执行"。
- `old ends.after`（时长）与 `ends.at`（时间点）可折算成 `expires` 的绝对时间；`ends.times`（运行次数上限）**没有任何对应字段**。
- 官方迁移脚本把 `ends_at` 写进 `expires_at`（migration L63），但**只迁移 `remaining_runs IS NULL` 的记录**——即带次数的任务整体被丢弃，不存在"次数丢失但任务保留"的中间态。
- `resume` 逻辑（core L1115-1130）：暂停期错过的 `at` 任务会 late 跑一次（除非已过期）；重复任务从下一个 slot 恢复；已完成/已过期的 resume 会直接置 `done`。

### 5.4 创建时的目标解析规则（core `resolveAction` L960-990）

- `action.to` 缺省时：`owner === undefined` → 报 `A prompt action needs \`to\` when there is no session`；否则默认 `{ session: owner.id }`。
- `to.session` 必须在**同一 project**，否则报 `Session ${id} is in another project`。
- `to.subagent` 必须有 owner session（作为父会话），否则报 `A prompt to a subagent needs a session to be its parent`。
- `code` action 必须有 owner session，否则报 `A code action needs a session`。
- 创建时 `directory` 优先级：owner session 的 directory → `input.directory` → `os.homedir()`；必须绝对路径且存在。

---

## 6. 功能保留及废弃清单

### 6.1 可直接迁移（新 API 原生支持）

| 旧功能 | 新实现 |
|---|---|
| 创建 prompt 定时任务（in / at / every / cron） | `automation.create`，trigger 字段对应；`to` 指向原 session |
| 列出任务 | `automation.list()`（零参数全量枚举） |
| 详情 / 暂停 / 恢复 / 删除 | `automation.get/pause/resume/delete` |
| 状态展示（active/paused/done） | `Status` 完全相同 |
| 运行状态与输出展示 | `lastOutcome`（去掉 `checked`）、`lastOutput`、`runCount` |
| 跳转到Session | GUI API `ctx.servers.list()` / `ctx.tabs.open()` **未变**，可保留 |

### 6.2 需要修改业务逻辑

| 项 | 改动 |
|---|---|
| 数据读取 | 删除 `session.list` + 分块扫描（`scan-coordinator.ts`），改为单次 `list()` |
| 类型来源 | `src/types.ts` 从 `@opencode/client/promise` 的 `Schedule*` 改为 `Automation*`；`package.json` 需显式加入 `@opencode/client`（当前仅 `@opencode/plugin`，靠传递依赖不可靠） |
| 字段格式 | `nextDueAt`/`expires`/`lastRunAt`/`time.*` 从 number 变 DateTimeUtc；`format.ts` 的时间格式化需适配 |
| `ends.after`/`ends.at` | 折算为绝对时间字符串放进 `expires` |
| 表单 trigger | `when.kind === "in"` 映射到 trigger `at`（保留输入 UI 或改文案）；新增 event trigger 支持与否由产品决策 |
| 错误分类 | 旧的 schedule 错误映射改为 `Automation.InvalidError/DisabledError/NotFoundError` + API 层的 `InvalidRequestError/ForbiddenError` |

### 6.3 新 API 不再支持（必须删除或产品决策）

| 旧功能 | 处置 |
|---|---|
| `if` 条件门禁（shell/code） | **删除 UI 与逻辑**；`ConditionDraft`/`ScheduleCondition` 相关类型删除 |
| `until` 条件门禁 | 同上 |
| `ends.times` 次数限制 / `remainingRuns` | **删除 UI 与逻辑**；`runCount` 只读展示 |
| `ScheduleOutcome = "checked"` | 从展示枚举中删除 |
| 依赖 `@opencode/plugin 2.2.5` | 升级到 2.3.2（见第 7 节） |

### 6.4 必须删除的废弃代码

- `src/scan-coordinator.ts` 及 `test/scan-coordinator.test.mjs`：整条按 session 分块扫描的协调逻辑（新 list 零参数即可全量）。
- `src/types.ts` 中 `ScheduleWhen` / `ScheduleCondition` / `ConditionDraft` / `ends.times` 相关类型与 `WhenDraft.in` 的旧映射（如保留 UI 输入则改为纯前端转换为 `at`）。
- `src/store.ts` 中所有 `experimental.schedule.*` 调用点（L102、L298、L331、L412、L417、L427、L442）。
- `src/gui/format.ts` 中针对 `ends.remainingRuns` / `checked` outcome 的格式化分支。
- `descriptions/关键词` 中 `schedule` 相关命名（可选，属于品牌/文案层）。

### 6.5 需要产品决策的功能

1. 是否在 UI 暴露 `code` action（新能力，有 30s/20 调用/32KB 限制，且需要 owner session）。
2. 是否支持 `event` trigger（受 mcp_events + tool-call 创建路径限制，GUI 无法直接创建，见 2.7）。
3. 旧的 `if`/`until` 门禁任务：官方迁移已丢弃，是否需要在文档/UI 中给出"已丢失"提示或导出清单？
4. 旧的 `ends.times` 次数任务：是否用 `code` action 的 `{ done: true }` + `runs` 计数做近似替代（属新实现，不在 B0 范围）？
5. 目标语义：创建时为旧任务保留"专用 Session"（`session.create` + `switchModel`/`switchAgent`，旧 `store.ts` L241-280）还是改为指向现有 session / subagent？
6. 是否保留 model/agent 高级选项（新 API 中 model/agent 是 Session 的属性，不再是 automation 的字段）。

---

## 7. 数据迁移风险

### 7.1 官方自动迁移规则（迁移脚本 `20261116043204_automation.ts` 全文已读）

**迁移条件（`WHERE` 子句，L73-76）** —— 必须同时满足：
```sql
s.status IN ('active', 'paused')
AND s.check IS NULL            -- 无 if/until 门禁
AND s.remaining_runs IS NULL   -- 无运行次数限制
AND s.next_due_at IS NOT NULL  -- 有明确下次触发时间
```

**字段映射（SELECT 子句）**：
| 旧 | 新 | 说明 |
|---|---|---|
| `'aut_' \|\| substr(s.id,5)` | id | ID 前缀变更 |
| `v.project_id` / `v.directory`（JOIN session_v2） | projectID / directory | 从 Session 推导 |
| `s.session_id` | sessionID | 保留 |
| `coalesce(s.name, substr(prompt,1,60))` | name | 名称兜底 |
| `when.type='in'` → `{type:'at', at: strftime(next_due_at/1000)}`；其余 `when` 原样 | trigger | **in 折算成绝对时间** |
| `{type:'prompt', prompt, to:{session:s.session_id}}` | action | 一律绑定原 Session |
| `s.ends_at` | expires_at | 字段映射，语义不同 |
| `s.last_fired_at` | last_run_at | |
| `s.last_message_id` / `s.last_outcome` / `s.retry_at` / `s.run_count` | 同名 | |

**最后执行 `DROP TABLE schedule`（L78）——不可逆**。

### 7.2 被丢弃的任务（⚠️ 数据丢失风险）

| 类型 | 迁移结果 | 依据 |
|---|---|---|
| 带 `if` / `until`（`check IS NOT NULL`） | **丢弃** | WHERE L74 + 注释 L40-42 |
| 带 `ends.times` / `remaining_runs` | **丢弃** | WHERE L75 |
| `status = 'done'`（已结束） | **丢弃** | WHERE L73 |
| `next_due_at IS NULL` | **丢弃** | WHERE L76 |
| 其他（active/paused、无门禁、无次数、有下次时间） | 迁移成功 | 同上 |

官方注释原文（L40-42）："Carry over live schedules that map onto automations unchanged: a prompt into their Session with no `if` or `until` check and no `ends.times` limit. Gated or counted schedules, and finished ones, are dropped, since without their condition or limit they would run differently."

### 7.3 其他风险点

- **重复执行**：`resume` 时错过的 `at` 任务会 late 跑一次（core L1117-1119）；`every`/`cron` 采用"跳过所有错过的 slot"而非补跑（L187-193）。UI 文案不应承诺"补跑"。
- **Event Trigger 投递不保证 exactly-once**，早期工具副作用不回滚（官方命令文档 L10）。
- **专用 Session 保留**：迁移绑定原 session；删除 Session 不删除 automation，但 code action / subagent target 在创建时需要 owner session（5.4）。
- **不同 Directory 的配置边界**：`experimental.automations` 按 directory 解析，跨目录枚举会按记录逐条过滤；目录被删的记录仍可见（handler L21-23）。
- **Automation.list 无需 Session**：这是与旧版最大差异，旧 store 的扫描逻辑不能再沿用。
- **模拟限制**：不能用本地代码模拟官方已不支持的能力（门禁、次数上限）；B 批不得造字段。

### 7.4 迁移状态接口

官方提供 `client.experimental.migration.v1.status()`（无参数），返回（types.d.ts L5973-5984）：
```ts
{ status: "required" | "completed" }
| { status: "running", progress: { label, numerator?, denominator? } }
| { status: "error", error: string }
```
可用于判断宿主是否已完成 schedule→automation 的库表迁移，作为插件启动时的前置检查（B 批）。

---

## 8. 依赖升级建议

| 依赖 | 当前 | 建议 | 理由 |
|---|---|---|---|
| `@opencode/plugin` | 2.2.5 | **2.3.2** | 与宿主 CLI 一致；GUI API 无破坏变化，已验证 |
| `@opencode/client`（新增显式依赖） | 无（靠传递） | **2.3.2**（B1 已加入并锁文件） | `types.ts` 需引用 `AutomationInfo` 等官方类型；避免传递依赖漂移 |
| `effect` (peer) | ^4.0.0 | 保持 | 2.3.2 SDK 仍基于 effect 4 |
| 其余 devDeps | — | 本次不动 | B0 约束：不升级依赖；实际升级留到 B1 并经审核 |

**版本/发布约束**：主版本从 0.1.x 迁移到新 API 属破坏性变更，建议单独批次决定版本号（不在 B0），并同步更新 README 中"定时任务 API 实验性、升级可能变动"的提示。

---

## 9. 后续 B1–B7 实施顺序

> 以下为建议拆分；**B0 到此停止，不进入 B1**，等待整体审核。

| 批次 | 主题 | 关键动作 | 依赖 |
|---|---|---|---|
| **B1** | 依赖与类型基线 | 升级 `@opencode/plugin`/`@opencode/client` 到 2.3.2；`types.ts` 切到 Automation 类型；跑通 typecheck（可先保留旧运行逻辑，编译期对齐） | B0 |
| **B2** | Store API 层迁移 | 7 处 `schedule.*` → `automation.*`；list 改零参数；新增 migration.v1.status 前置检查；错误映射重写 | B1 |
| **B3** | 查询与扫描简化 | 删除 `scan-coordinator.ts` 及相关测试；`session.list` 分块逻辑移除；store 单测重写 | B2 |
| **B4** | 字段与时间适配 | DateTimeUtc/number 转换；`ends.after/at` → `expires`；`lastOutcome` 去 `checked`；`format.ts` 改造 | B2 |
| **B5** | 表单与页面 | 删除 if/until/times UI；trigger/action/to 表单改造；状态展示适配；跳转 Session 保留（GUI API 未变） | B4 + 产品决策 |
| **B6** | 文档与提示 | README/文案从 schedule 改 automation；实验开关说明；"已丢弃任务"提示与导出方案 | B5 |
| **B7** | 回归与发布准备 | 全量测试 + 真机验证（2.3.2 Desktop）；版本号/CHANGELOG 决策；发布评审 | B1–B6 |

---

## 10. 每批次验收标准

| 批次 | 验收标准 |
|---|---|
| B0 | ✅ 官方 SDK 类型已核实（schema 2.3.2 全文）✅ 六个接口已核实 ✅ list 查询边界已核实（handler 逐行）✅ Target 完整定义已核实 ✅ 旧任务迁移规则已核实（迁移脚本逐行）✅ 无推测当事实 ✅ 本文档形成 |
| B1 | `npm run typecheck` 通过；`package.json` 版本符合建议；无 production 逻辑改动混入 |
| B2 | 所有 `experimental.schedule` 引用为 0；`automation.*` 调用签名与 2.3.2 SDK 一致；错误分类覆盖 Disabled/Invalid/NotFound；store 单测通过 |
| B3 | `scan-coordinator.ts` 与其测试删除；`session.list` 调用为 0；list 零参数返回全量的单测通过 |
| B4 | 时间字段转换单测覆盖（number↔DateTimeUtc）；`ends.after/at`→`expires` 转换正确；`checked` 不再出现 |
| B5 | 表单不再提交 if/until/times；create payload 通过 2.3.2 校验（含 `to` 必填语义）；页面展示新 Status/Outcome；跳转 Session 功能回归通过 |
| B6 | 文档/文案中 `schedule` 残留仅为历史说明；实验开关与 event 限制说明完整 |
| B7 | 全套 `npm test` 通过；在 2.3.2 Desktop 实测无 `Cannot read properties` 报错；版本号与 CHANGELOG 经审核 |

---

## 附录 A：核查来源索引

| 结论 | 来源 | 版本/commit |
|---|---|---|
| Automation 全套类型（Info/Target/Action/Trigger/Status/Outcome 等） | `@opencode/schema@2.3.2` `dist/automation.d.ts` | 2.3.2 |
| 六个 SDK 方法与 Input 定义 | `@opencode/client@2.3.2` `dist/promise/client.d.ts`、`generated/types.d.ts` | 2.3.2 |
| list 查询边界、directory→projectID、可见性过滤、router 错误映射 | `packages/server/src/handlers/automation.ts` | a0fdbf9 |
| 核心 create/list/pause/resume/remove、expires 语义、目标解析、实验开关 | `packages/core/src/automation.ts` | a0fdbf9 |
| 旧任务迁移规则 | `packages/core/src/database/migration/20261116043204_automation.ts` | a0fdbf9 |
| 官方命令说明（trigger/action/target/expires/event） | `packages/core/src/plugin/command/automation.txt` | a0fdbf9 |
| 迁移状态接口 | `@opencode/client@2.3.2` `ExperimentalMigrationV1StatusOutput` | 2.3.2 |
| 旧 Schedule 类型（对照） | `@opencode/client@2.2.5` `generated/types.d.ts` | 2.2.5 |
| GUI API 无变化 | `diff @opencode/plugin@2.2.5 vs 2.3.2 dist/gui/context.d.ts`（仅注释） | 2.2.5 / 2.3.2 |
| 端点删除/改名实测 | 2.3.2 CLI 二进制 `strings` 计数 | 2.3.2 |

官方源码链接模板：`https://github.com/anomalyco/opencode/blob/a0fdbf9b91ed2cf8bfd778ccec340285403eddc2/<path>`
npm 包：`https://www.npmjs.com/package/@opencode/client/v/2.3.2`、`/package/@opencode/schema/v/2.3.2`、`/package/@opencode/plugin/v/2.3.2`

## 附录 B：B0 未做的事（明确边界）

- 未修改任何生产代码、`package.json`、锁文件、版本号。
- 未升级依赖、未合并 main、未创建 Tag、未发布 npm。
- 未实现任何功能、未用本地代码模拟官方不支持的能力。
- 所有临时核查文件在 `/tmp/opencode-baseline-b0/`，未写入生产仓库；本仓库唯一新增文件为本文档。
