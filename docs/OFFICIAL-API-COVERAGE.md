# 官方 API 能力覆盖审计

> **历史归档（2.2.5 / `schedule.*`）**：本文档审计的是旧版 `@opencode/client` 2.2.5 的 `experimental.schedule.*`。0.2.0 起插件已迁移到 OpenCode 2.3.2 的 `experimental.automation.*`，下表中的接口与缺口不再对应当前实现；当前覆盖情况请以根目录 `README.md` 和 `src/store.ts` 为准。

- 基线：批次 1 收尾提交 `f564129`（分支 `fix/schedule-safety-batch1`）
- 审计对象：`@opencode/client` 2.2.5 / `@opencode/plugin` 2.2.5 的 `experimental.schedule.*`
- 方法：逐个核对 `src/` 真实调用链 + SDK `dist/promise/generated/types.d.ts` 官方 Schema + `api.d.ts`，**不采信 README 与本地类型声明的自述**
- 标记口径：`已完整接入` / `已部分接入` / `尚未接入` / `不需要接入` / `存在重复实现，需要清理`

---

## 1. 官方接口调用

| 接口 | SDK 签名（2.2.5） | 插件调用点 | 结论 |
|---|---|---|---|
| `schedule.list` | `({sessionID}) → ScheduleInfo[]` | `store.ts:100`（全会话扫描）、`store.ts:288`（创建结果核对） | **已完整接入** |
| `schedule.create` | `({sessionID, name?, when?, if?, until?, ends?, prompt}) → ScheduleInfo` | `store.ts:257` | **已部分接入**：传了 `name/when/prompt/ends`；`if`/`until` 从未传；`when.in` 的 `tz` 被主动省略 |
| `schedule.get` | `({scheduleID}) → ScheduleInfo` | **无任何调用**（全仓 grep 仅命中 list/create/pause/resume/delete） | **尚未接入**。当前用 `list({sessionID})` 核对创建结果，见 §5 取舍说明 |
| `schedule.pause` | `({scheduleID}) → ScheduleInfo` | `store.ts:364` | **已完整接入**：用官方返回值 patch 缓存 |
| `schedule.resume` | `({scheduleID}) → ScheduleInfo` | `store.ts:369` | **已完整接入**：同上 |
| `schedule.delete` | `({scheduleID}) → void` | `store.ts:379` | **已完整接入**：只删 schedule，不删 session（批次 1 已修） |

补充：`session.create` / `session.remove` / `session.get` / `session.switchModel` / `model.list` / `provider.list` / `agent.list` 均为官方接口，用于承载会话与目录/模型/agent 选择，属于已接入的宿主能力，不在 schedule 覆盖清单内但链路合规。

---

## 2. 官方数据字段（`ScheduleInfo` → 展示）

官方 Schema 共 16 个字段。逐个核对 `ScheduleDetail`（`form.tsx:1021-1118`）、列表卡片（`page.tsx:362-448`）、`ScheduleConfig`：

| 字段 | 官方定义 | 插件展示 | 结论 |
|---|---|---|---|
| `id` | `ScheduleID` | 用作 row key / aria / 展开态 | 已完整接入 |
| `sessionID` | `string?` | 详情「绑定会话」、打开会话回退值 | 已完整接入 |
| `name` | `string?` | 卡片标题、详情（经 `scheduleTitle`） | 已完整接入 |
| `when` | `ScheduleWhen` | 列表 `describeWhen`、预览 | 已完整接入（展示层） |
| `tz` | `string`（**必填**） | **完全未展示**；`WhenDraft` 仅 at/every/cron 可选携带 | **尚未接入** — 官方返回的时区不呈现，用户无法确认任务按哪个时区解释 |
| `if` | `ScheduleCondition?` | **完全未展示** | **尚未接入** |
| `until` | `ScheduleCondition?` | **完全未展示** | **尚未接入** |
| `action` | `{type,prompt}` | 详情「提示词」、卡片摘要、搜索 | 已完整接入（type 恒为 prompt，无需单独展示） |
| `status` | `active\|paused\|done` | 状态徽章 + 筛选 + 排序 | 已完整接入 |
| `nextDueAt` | `number?` | 卡片「下次」倒计时、详情 | 已完整接入 |
| `endsAt` | `number?` | **完全未展示** | **尚未接入** — 官方给的结束时间没有出口 |
| `remainingRuns` | `number?` | 详情「剩余 N 次」 | 已完整接入 |
| `runCount` | `number` | 详情「已触发 N 次」 | 已完整接入 |
| `lastFiredAt` | `number?` | 卡片「上次」、详情 | 已完整接入 |
| `lastOutcome` | `ScheduleOutcome?` | `outcomeLabel` 徽章 | **已部分接入**：7 个官方值中 `disabled` 无专门文案，落到 `return {text: outcome, tone:"warn"}` 兜底，会向用户显示英文原值 `disabled` |
| `lastOutput` | `string?` | 详情「上次输出」+ 复制 | 已完整接入 |
| `time` | `{created,updated}` | 仅 `time.created`（「创建于」）；`time.updated` 未展示 | **已部分接入**（`created` 完整、`updated` 未用） |

状态/结果展示规则对照（总纲第四批表）：

| 官方值 | 总纲要求 | 当前实现 | 结论 |
|---|---|---|---|
| `active` | 显示进行中 | 徽章「已启用」 | 语义一致，文案为「已启用」（见 §6 观察项） |
| `paused` | 显示已暂停 | 「已暂停」 | 一致 |
| `done` | 显示已结束 | 「已结束」 | 一致 |
| `fired` | 显示已触发 | 「已触发」 | 一致 |
| `late` | 显示延迟触发 | 「延迟触发」 | 一致 |
| `checked` | 显示条件检查 | 「条件未满足」 | **语义偏差**：checked 是「条件已检查」，不等于「未满足」（未满足通常是 skipped） |
| `expired` | 显示已过期 | 「已过期」 | 一致 |
| `skipped` | 显示已跳过 | 「已跳过」 | 一致 |
| `disabled` | 显示已禁用 | 兜底显示英文 `disabled` | **尚未接入** |
| `failed` | 显示执行失败 | 「触发失败」 | 一致 |

`status` 与 `lastOutcome` 是否分开表达：**是**。卡片同时渲染 status 徽章（365-367）与 outcome 徽章（439-446），两者互不覆盖。此项达标。

---

## 3. 官方创建参数（`CreateDraft` / 表单 / 创建请求）

官方 `ExperimentalScheduleCreateInput`（`types.d.ts:5443-5503`）：`sessionID, name?, when?, if?, until?, ends?, prompt`。

| 字段 | 官方 | 本地链路 | 结论 |
|---|---|---|---|
| `sessionID` | 必填 | `store.ts:226` 先 `session.create` 拿 id 再传入 | 已完整接入 |
| `name` | 可选 | 表单 `name()` → `CreateDraft.name` → create | 已完整接入 |
| `prompt` | 必填 | 表单 → create | 已完整接入 |
| `when.in` | `{in, tz?}` | `WhenDraft.in` **无 tz 字段**；`store.ts:269` 对 `kind==="in"` 主动省略 tz（`: {(when.kind === "in" ? {} : when.tz ? { tz: when.tz } : {})}`） | **已部分接入**：官方 in 明确支持可选 tz，被现有代码省略 |
| `when.at` | `{at, tz?}` | `WhenDraft.at` 带 tz，但表单无时区输入控件，`draft()` 只产 `{kind,at}`，tz 恒为 undefined | **已部分接入**：类型支持但 UI 无入口，实际不会传 |
| `when.every` | `{every, tz?}` | 同 at | **已部分接入**：同上 |
| `when.cron` | `{cron, tz?}` | 同 at | **已部分接入**：同上 |
| `ends.times` | `number?` | 表单「最多触发次数」→ `endsWith()` → `CreateDraft.ends`，仅 every/cron 可用（`form.tsx:269`） | 已完整接入（限 every/cron） |
| `ends.after` | `string?`（Duration） | 表单无入口，`CreateDraft.ends` 类型允许但 UI 不产 | **尚未接入** |
| `ends.at` | `string?` | 同上 | **尚未接入** |
| `if` | Shell / Code 条件 | `CreateDraft` 无此字段，表单无 UI，create 从不传 | **尚未接入** |
| `until` | Shell / Code 条件 | 同上 | **尚未接入** |

四种触发方式映射一致性：`in/at/every/cron` 均保留，参数名与官方一致（`in`/`at`/`every`/`cron`），无自创字段。此项达标；唯一缺口是 tz（见上表）。

官方 `if`/`until` 的 Shell 结构为 `{run, is?, matches?, changes?}`、Code 为 `{code}`，**create 入参不带 `type` 判别字段**（与返回的 `ScheduleCondition` 不同）。补接入时必须按入参形状传，不能照搬返回类型——这是最容易踩的坑，记入 §7。

---

## 4. 重复实现核查

| 代码 | 位置 | 性质 | 结论 |
|---|---|---|---|
| `isValidCron` + `CRON_FIELD_RANGES` + `parseCronField` | `format.ts:132-168` | 本地 5 字段 cron 校验器 | **存在重复实现，需要清理**：`form.tsx:229` 用它决定 `draft()` 是否为 null，进而 `canSubmit()` 为 false——**本地校验已成为创建任务的硬门禁**，直接违反「本地校验不能成为最终依据」。创建成功与否必须以官方接口响应为准 |
| `describeCron` | `format.ts:39-84` | 本地 cron → 中文描述 | **存在重复实现，需要清理**（降级为参考）：这是展示辅助，不是调度依据；但 `page.tsx:424` 用它作为列表「触发方式」的唯一描述，用户可能误读为官方解释 |
| `nextCronRuns` + `fieldMatches` + `daysInMonth` | `format.ts:196-246` | 本地推算 cron 未来触发时间 | **存在重复实现，需要清理**：`previewRuns` 用它算「接下来」5 次（`form.tsx:248`、`609-619`），并在 `form.tsx:372` 明写「将于 X 首次触发」。**未标注「预计/参考预览」**，且与官方 `nextDueAt` 语义撞名风险高——总纲明确禁止把本地计算当作官方 `nextDueAt` |
| `previewRuns`（in/at/every 分支） | `format.ts:257-274` | 本地推算首次触发时间 | **存在重复实现，需要清理**：同样喂给「将于 X 首次触发」文案，未标预计 |
| 本地 `durationMs` / `durationLabel` | `format.ts:4-28` | 时长文本 ↔ 毫秒换算 | 展示辅助，非调度逻辑，**不需要接入**（不清理） |
| `relativeTime` / `clockText` | `format.ts:93-118` | 时间格式化 | 纯展示，**不需要接入** |
| 自研下次触发时间计算 | — | 全局 grep 无 | 无（列表 `nextDueAt` 直接取官方值） |
| 自研生命周期/结束判定 | — | 无；`ends` 仅透传 `times` | 无 |
| 自研执行状态维护 | — | 无；status 直接取官方，pause/resume 用官方返回值 | 无 |
| 自研执行次数计数 | — | 无；runCount/remainingRuns 直接取官方 | 无 |
| 立即执行按钮 | — | 无 | 无（符合明确不做事项） |
| 本地任务数据库 / 持久化 | — | 无；仅内存缓存 | 无 |
| `draftToWhen` | `format.ts:249-254` | 定义但全仓无调用 | **死代码，需要清理** |

---

## 5. 接口取舍：`schedule.get` 与 `list` 核对

- 官方提供 `schedule.get({scheduleID})`，插件未调用。
- 创建结果核对（`store.ts:285-309`）用 `schedule.list({sessionID})`：因为 create 失败时还没有 `scheduleID`，`get` 无从调用；`list` 按 sessionID 查询恰好能在新建的专用会话里定位是否写入成功。
- 结论：**当前取舍合理，不需要为「覆盖而覆盖」接入 get**。但需在批次 5 明确一条按需使用边界：如需核对**单个已知任务**的最新状态（例如操作失败后的对账），可用 `get` 而非全量 `list`，避免 N 次会话扫描。此项列入批次 5 待办，不在本批改码。

---

## 6. 其他观察项（不属本批改码范围）

1. `agent` 配置回读：模型有显式回读确认（`store.ts:233-252`：`session.get` + `sameModel`），但 `agent` 只在 `session.create` 时传入，**没有回读确认实际生效**。与总纲「Agent 配置回读应确认实际生效」的核查点对应，列入批次 3/5 评估。
2. 状态文案 `active` → 「已启用」与总纲表「显示进行中」措辞不同，语义一致；`checked` → 「条件未满足」存在语义偏差。列入批次 4 修正。
3. README（`README.md:61,64`）自述数据源只列 `{list,create,pause,resume,delete}`，未提 `get` 未接入；`cron 预览` 段落未声明「预计/参考」，需随批次 3/4 同步更新，保持文档与实际能力一致。
4. 本地 `types.ts:1-41` 手写镜像了官方 Schema。已验证 `@opencode/client/promise` **正式导出** `ScheduleInfo`/`ScheduleWhen`/`ScheduleStatus`/`ScheduleOutcome`/`ScheduleCondition`（`index.d.ts:3` → `generated/index.d.ts:3` → `generated/types.d.ts`，实测 `tsc` 导入退出码 0）。因此本地镜像**并非必需**，存在 SDK 升级后字段漂移风险。建议批次 4/5 直接 `import type` 官方类型，删除镜像——不建转换层。

---

## 7. 分批整改映射（本批只审计，不改码）

| 缺口 | 处理批次 | 动作 |
|---|---|---|
| `if`/`until` 未接入（表单 + 传参） | 批次 3 | 收进高级选项，只提供官方入参结构 `{run,is?,matches?,changes?}` / `{code}`，不自创语法、不在插件执行条件 |
| `ends.after`/`ends.at` 未接入 | 批次 3 | 增加「结束条件」区，默认不设置，选择后展开；只透传参数、展示官方返回的 `endsAt`/`remainingRuns` |
| `in` 的 tz 被省略 + at/every/cron 无时区输入 | 批次 3 | 统一提供可选 tz 输入，四种方式都按官方 Schema 传 |
| Cron 本地校验作为创建硬门禁 | 批次 3 | 取消本地校验对 `canSubmit` 的阻断，改由官方响应裁决；本地校验降级为输入提示 |
| Cron 预览未标「预计」 | 批次 3 | 预览文案加「预计/参考」前缀，禁止与官方 `nextDueAt` 混用 |
| `draftToWhen` 死代码 | 批次 3 | 删除 |
| `tz`/`if`/`until`/`endsAt` 未展示；`disabled`/`checked` 文案 | 批次 4 | 详情按三区组织补齐官方字段，修正状态/结果翻译表；不展示 `time.updated` 之外官方没有的字段 |
| 手写类型镜像 | 批次 4/5 | 改用官方导出类型，删本地镜像，不建转换层 |
| `schedule.get` 按需对账边界 | 批次 5 | 操作失败对账用 `get`，避免全量扫描 |
| agent 回读 | 批次 5 | 评估是否用 `session.get` 确认 agent 生效 |
| README 与实际能力对齐 | 批次 4/6 | 更新数据源、cron 预览声明 |

---

## 8. 本批结论

- 官方 6 个 schedule 接口中，`list/create/pause/resume/delete` 已接入，`get` 尚未接入但当前场景不需要（取舍见 §5）。
- 官方创建参数 `if`/`until` 完全缺失、`ends.after/at` 缺失、四种 `when` 的 tz 实际不传——这是「能力覆盖」的最大缺口。
- 存在 4 处与官方语义重复的本地逻辑（cron 校验/描述、cron 未来时间推算、preview 首次时间），其中 **cron 本地校验已成为创建硬门禁**，违反总纲，必须优先清理。
- 官方返回的 `tz`/`if`/`until`/`endsAt` 展示层完全缺失，`disabled`/`checked` 结果文案不准。
- `status` 与 `lastOutcome` 分开表达达标；无自研调度器、无本地持久化、无立即执行/编辑接口。
- 本批为**只读审计**，未修改任何功能代码；上述缺口全部按批次映射到批次 3-6 处理。
