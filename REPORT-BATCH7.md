# Batch 7 · 最终验收阻断项修复报告

## 基线

| 项 | 值 |
|---|---|
| 仓库 | meiyx7/opencode-schedule-center |
| 分支 | `fix/schedule-safety-batch1`（未在 main 开发，未合并 main） |
| 基线 HEAD | `c7110f28d30c1e4a49b20dd122c5246542b1a974` |
| 版本 | `0.1.16`（未改动） |
| 本批性质 | 只修最终审核发现的 4 个可靠性缺陷，不新增产品功能 |

## 1. 修改文件与原因

| 文件 | 改动 | 原因 |
|---|---|---|
| `src/store.ts` | `listAll()` 扫描基准前移 + 保护性合并；`inflightCreate` 单对象改为 `inflightCreates: Map`；新增 `classifyCreateError`（导出）+ `CreateErrorKind`；`reconcileCreate` 回滚条件收紧；`describeError` 支持结构化错误 | TASK-07 / 08 / 09 |
| `src/scan-coordinator.ts` | `primed`（成功才算）改为 `attempted`（首次尝试即算） | TASK-10 |
| `test/store.test.mjs` | 新增 TASK-07/08/09 共 22 项测试；修正 2 处旧 mock 为 SDK 真实错误结构 | 覆盖新增修复 |
| `test/scan-coordinator.test.mjs` | 替换旧"首次失败一直算首次"测试；新增 TASK-10 六项测试 | TASK-10 |

未改动 UI、版本号、官方 API 语义；未引入持久化、调度逻辑、状态框架、请求队列或新依赖。

## 2. 每项问题的修复方式

### TASK-07 扫描期间并发数据丢失
- **根因**：`mutationSeq` 基准在 `fetchAllSessions()` 之后才记录，分页期间发生的创建无法被检测；且 `this.sessions = sessions` 无条件用扫描快照覆盖本地缓存，冲掉新建 Session 的元数据。
- **修复**：
  1. 基准 `seqAtStart` 移到 `listAll()` 第一次 `await` 之前，覆盖整个会话分页窗口。
  2. 提交时若 `mutationSeq !== seqAtStart`（扫描期间有本地写入），走保护分支：`scheduleCache` 与 `sessions` 都**只对本地缺失的 key 补充**，不覆盖任何已有条目——因此新建任务、新 Session 的 model/agent/directory、以及 pause/resume/delete 结果全部保留。
  3. `rowsFrom` 改用合并后的 `this.sessions` 而非旧快照，保证新 Session 元数据进入返回行。
  4. 无并发变更时仍整体采用官方快照，因此后续刷新能正常拿到最新数据，不会被永久阻塞。

### TASK-08 多草稿并发创建去重
- **根因**：`inflightCreate` 是单个 `{key, promise}`，A/B/A 交错时 B 会覆盖 A 的记录，第二次 A 被误判为新请求，产生重复任务。
- **修复**：改为 `Map<draftKey, Promise>`。相同 key 复用在途 Promise；不同 key 并发执行。`finally` 中用 `if (get(key) === task) delete(key)` 确保只清理自己的记录，不误删同 key 的新 Promise。`draftKey` 覆盖 name/prompt/when/ends/if/until/model/agent/directory 全字段（本批前已具备）。

### TASK-09 创建异常分类与回滚安全
- **根因**：旧 `isIndeterminateError` 用 `error instanceof Error` + 消息字符串匹配，而 SDK 2.2.5 的 5xx 错误（`ServiceUnavailableError`/`UnknownError`）带 `_tag` 且是 Error 实例，字符串匹配覆盖不到 → 5xx 被误判为"明确失败"触发危险回滚。
- **核实 SDK 实际结构**（查 `node_modules/@opencode/client/dist`）：
  - `declared()` = `Object.assign(new Error(message), body)`，并设置 `name = _tag`：业务错误是**带 `_tag` 的 Error 实例**；
  - `ClientError extends Error`，有 `reason`；`UnexpectedStatus` 的 `cause.status` 是数字，`Transport`/`MalformedResponse`/`UnsupportedContentType` 为其他 reason；
  - fetch 网络/abort/解析可能表现为原生 `TypeError`/`AbortError`/`SyntaxError`。
- **修复**：`classifyCreateError` 先读 `_tag`（保证 Error 实例上的标签不被 `instanceof Error` 分流），再判 `name === "ClientError"` 的 reason/status，最后判原生 Error 子类。输出 7 类：`explicit-rejection` / `server-error` / `timeout` / `abort` / `network` / `parse-error` / `unknown`。回滚条件收紧为：**仅当 `explicit-rejection` 且官方 `schedule.list({sessionID})` 核对为空**才回滚；5xx、超时、429、Abort、网络、解析失败、未知异常、核对失败一律保留承载会话。不使用任何消息字符串猜测状态码。

### TASK-10 首次扫描语义
- **根因**：coordinator 的 `primed` 只在扫描成功时置位，导致首次失败后每次重试都被标记为 `firstLoad=true`，与页面"首次尝试已结束"的语义不一致。
- **修复**：改用 `attempted`，在第一次 `refresh()` 发起时立即置位（无论成败）。首次失败后第二次失败即为 `firstLoad=false`。并发复用、busy 归位逻辑保持不变。页面层 `page.tsx` 的 `primed`/`scanFailed`/`dataUnknown` 语义已与之一致（首次失败显示"状态暂不可确认"而非空列表），本批未改 UI。

## 3. 新增测试覆盖场景

| 任务 | 测试数 | 覆盖 |
|---|---|---|
| TASK-07 | 5 | 分页间创建→任务与新 Session 的 model/agent/directory 全保留；扫描期间 pause / resume / delete 不被旧快照覆盖；扫描结束后再次刷新正常采用官方最新数据 |
| TASK-08 | 6 | A/A、A/B、A/B/A 交错；A 失败 B 成功互不影响；成功后重提允许新建；含 tz/ends/if/until 的草稿去重 |
| TASK-09 | 15 | 400/401/403→explicit-rejection；408/429；500/502/503（tagged + ClientError status 两种形状）；Timeout/Abort/网络/解析失败；结构不完整与字符串不猜状态；明确拒绝+空列表回滚；5xx/未知+空列表不回滚；list 命中认领；list 失败保留会话；Error 实例+`_tag` 仍正确分类 |
| TASK-10 | 6 | 首次失败 firstLoad=true；第二次失败 false；首次失败后成功；成功后失败保留旧数据；busy 归位；多次并发只扫描一次 |

错误对象均按 SDK 2.2.5 真实结构构造（`Object.assign(new Error(msg), {_tag, name})` 与 `ClientError` 形状的 Error），不使用裸对象或消息字符串。

合计 **85 项测试全部通过**（本批前 53 项）。

## 4. 验证结果（实际执行）

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 通过，0 错误 |
| `npm test` | 通过，85 tests / 12 suites / 0 fail |
| `npm run build` | 通过（dist/gui-experimental.cjs） |

独立第三方审查（只读）已执行：4 项修复主路径均判定正确，无严重问题；审查指出的"错误对象注释/测试前提与真实 SDK 结构相反"已修正（见 §2 TASK-09 与 §3）。

## 5. Git 与交付

| 项 | 值 |
|---|---|
| 新提交 SHA | 见下方 commit 记录（`git log -1`） |
| 分支 | `fix/schedule-safety-batch1` |
| 相对 main | ahead 7 / behind 0 |
| 约束 | 未合并 main、未发 npm、未建 Tag/Release、未建 PR、版本仍 0.1.16 |

## 6. 未解决问题（本批范围外，仅记录）

1. **`refreshSessions()` 无并发保护**（`src/store.ts`）：该方法 `this.sessions = sessions` 无条件覆盖，不比对 `mutationSeq`。仅由 `recentDirectories()` 在表单挂载且 sessions 为空时触发，实际难与创建并发。彻底闭环可套用 TASK-07 的合并策略——属范围外，未改。
2. **`commitCreated` 不回读 `draft.agent`**（批次5遗留）：若宿主忽略 create 的 agent 参数且后续 switchAgent 未写回，元数据可能显示旧 agent。本批测试改为让 session 自带 agent 验证"并发不被覆盖"，未改既有逻辑。
3. **既有 model/agent 回读 bug**：`createOnce` 中 `modelConfirmed = !draft.model`，当 create 返回的 model/agent 已匹配时跳过确认块但标志仍为 false，会误报"无法确认"。需单独批次修复，本批未动。
4. **4xx 保守边界**：`ConflictError(409)`/`SessionBusyError` 及 `UnexpectedStatus` 的 400–499 归为 explicit-rejection；对全新独立挂载 Session 的 create 而言 409 不会出现，当前安全。若未来复用 Session 创建，需将 409 单独按 unknown 处理。

以上均为观察项，不影响本批 4 项验收。

本批完成后停止，等待整体审核。
