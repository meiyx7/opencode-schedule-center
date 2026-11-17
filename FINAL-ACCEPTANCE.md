# 最终验收报告（Batch 10 · 发布来源校验与验收材料修正）

本文是分支 `fix/schedule-safety-batch1` 的最终验收依据，覆盖批次 1–10 全部工作，以最新源码与测试为准重写，不沿用批次 6 报告的结论。Batch 10 只补充发布 Tag 来源保护并修正本报告，不改变业务功能、不改业务代码。

## 1. 批次与提交

| 批次 | 内容 | Commit |
|---|---|---|
| 基线 | main @ v0.1.16 | `d652103` |
| 1 | 安全与可靠性修复（TASK-01~05）+ 整体审核收尾 | `5a23f24`、`f564129` |
| 2 | 官方 Schedule API 覆盖审计 | `c657592` |
| 3 | 创建参数补齐（tz / ends / if / until / Cron 重定位） | `1756275` |
| 4 | 数据展示一致性（官方类型复用 / 状态文案 / 字段补齐） | `862ed1b` |
| 5 | 生命周期操作与按需对账（get 单任务核对 / agent 回读） | `6899f72` |
| 6 | 整体验收与 README 对齐 | `c7110f2` |
| 7 | 最终验收阻断项修复（并发保护 / 去重 / 错误分类 / 首次扫描语义） | `085495c` |
| 8 | model / agent 创建确认逻辑修复（TASK-11~13） | `444c416` |
| 9 | 发布门禁修复（publish.yml 补测试与版本校验）与验收材料收尾 | `59cea9d` |
| 10 | 发布 Tag 来源校验（仅 main 已含提交可发布）与验收报告修正 | 本提交 |

- 分支：`fix/schedule-safety-batch1`。批次 9 推送后相对 main 为 **ahead 10 / behind 0**；Batch 10 本提交推送后为 ahead 11 / behind 0。
- CI 实际验证记录：`444c416`（批次 8）→ run `44017866072` 全绿；`59cea9d`（批次 9）→ run `44019318036` 全绿（均由 PR #1 的 `pull_request` 事件触发）。Batch 10 提交推送后将触发新 run，最终结论以最新 SHA 的 CI 为准。
- 版本号仍为 `0.1.16`，未合并 main、未发 npm、未建 Tag/Release。

## 2. 功能验收

| 验收项 | 结论 | 依据 |
|---|---|---|
| 四种触发方式均能正确创建 | 通过 | `form.tsx` 四种 draft；`store.ts` 按 kind 映射 in/at/every/cron；批次 3 测试覆盖 |
| 时区参数正确传递 | 通过 | 四种 when 均可选 tz 并原样透传；批次 3 测试断言 `in` 的 tz 不被省略 |
| 任务名称与 Prompt 正确传递 | 通过 | create 传 name/prompt；测试覆盖 |
| ends 三种参数正确传递 | 通过 | `buildEnds()` 产出互斥的 times/after/at；批次 3 测试三种各断言 |
| if / until 按官方结构传递 | 通过 | `buildCondition()` 产出无 `type` 判别字段的官方入参；批次 3 测试断言 |
| 指定 model 且宿主直接接受时创建成功 | 通过 | 批次 8 修复初始化误判；测试断言不调用 switchModel、不回滚 |
| 指定 model 且宿主未接受时切换并回读确认 | 通过 | switchModel + `session.get` 回读为准；回读匹配成功、失败/不匹配均回滚（批次 8 测试） |
| 指定 Agent 直接接受 / 切换确认 / 失败回滚 | 通过 | 与 model 对称实现；批次 8 测试覆盖全部路径 |
| 缓存元数据与已确认的实际值一致 | 通过 | `commitCreated` 不再用请求值覆盖；直接接受路径存服务端对象、切换路径存回读值，目录等元数据不丢（批次 8 测试） |
| 列表数据与官方返回一致 | 通过 | 字段直接取官方 `ScheduleInfo`，类型复用 SDK 导出，无本地镜像（批次 4） |
| 状态与结果分别展示 | 通过 | status 徽章与 lastOutcome 徽章并列；7 个 outcome 各有明确文案（批次 4 测试） |
| 暂停 / 恢复 / 删除遵循官方接口 | 通过 | 均调官方接口、用官方返回值更新缓存、失败保留原状态（批次 5 测试） |
| 无删除 Session 行为 | 通过 | `remove()` 只调 `schedule.delete`；批次 1/5 测试断言 `session.remove` 未被调用 |

## 3. 可靠性验收

| 验收项 | 结论 | 依据 |
|---|---|---|
| 并发扫描不覆盖本地更新 | 通过 | `mutationSeq` 基准覆盖整个分页窗口 + 保护性合并；扫描期间 create/pause/resume/delete 不丢（批次 7 TASK-07 测试） |
| 并发创建不产生重复任务 | 通过 | 按 `draftKey` 的 in-flight Promise Map 管理多草稿；A/B/A 交错、A 失败 B 成功互不影响、成功后重提允许新建（批次 7 TASK-08 测试） |
| 创建异常分类与回滚安全 | 通过 | SDK 2.2.5 真实错误结构分类 7 类；仅"明确拒绝且官方 list 核对为空"才回滚，5xx/超时/网络/未知一律保留会话（批次 7 TASK-09 测试） |
| 首次扫描语义统一 | 通过 | `attempted` 语义：首次尝试无论成败即结束首次；页面"状态暂不可确认"而非空列表（批次 7 TASK-10 测试） |
| 超时与未知结果不误回滚 | 通过 | create 异常先 `schedule.list({sessionID})` 核对；核对失败一律保留会话（批次 1/7 测试） |
| 分页截断不伪装完整 | 通过 | 达上限仍有 next 时 `truncated=true`，页面明确提示（批次 1 测试） |
| 部分失败不清空任务 | 通过 | 失败会话保留旧缓存条目并记录原因（批次 1 测试） |
| 操作失败按需核对 | 通过 | `reconcile()` 用官方 get 只核对单任务，不重扫全会话（批次 5 测试） |

## 4. 架构验收

| 验收项 | 结论 | 依据 |
|---|---|---|
| 无自研调度器 | 通过 | 全仓无调度循环；定时器仅用于 UI 倒计时、可见态刷新、防抖、复制反馈 |
| 无自研 Cron 执行器 | 通过 | `format.ts` 的 cron 解析仅作"预计/仅供参考"预览，不作创建门禁、不作 nextDueAt |
| 无本地任务库 / 持久化 | 通过 | grep 无 localStorage/IndexedDB/文件写入 |
| 不自维护执行次数与生命周期 | 通过 | runCount/remainingRuns/endsAt/status 全取官方 |
| 官方数据优先，不重复维护状态 | 通过 | 类型复用 SDK 导出；pause/resume 用官方返回值 patch 缓存 |
| 无额外新抽象 | 通过 | 仅保留 `scan-coordinator`（单飞刚需）与一个复用条件编辑器；Batch 8 只做最小改动 |
| 无立即执行 / 编辑接口 | 通过 | 官方 API 未提供，插件未伪造 |

## 5. 官方 API 职责边界

- 官方能力：`schedule.create/list/get/pause/resume/delete`，均为 Experimental；`list` 必须按 `sessionID` 查询；无独立更新或立即执行接口。
- 插件定位：前台管理与呈现，调度与执行完全依赖官方；不为补功能自建调度器、Cron 执行器或本地任务库。
- Session 侧仅使用 `session.create/get/switchModel/switchAgent/remove`：remove 仅用于创建失败的安全回滚，删除任务不再触碰承载会话。

## 6. 工程验收（区分本机验证与 CI 实际验证）

| 项目 | 结果 | 验证渠道 |
|---|---|---|
| `npm run typecheck` | 通过，0 错误 | 本机实测（批次 8/9/10 提交）+ CI run `44019318036` |
| `npm test` | 通过，**96/96**（13 个 suite，零新依赖，全部 Mock client） | 本机实测 + CI run `44019318036` |
| `npm run build` | 通过，单文件 `dist/gui-experimental.cjs`（108.55 kB / gzip 30.27 kB） | 本机实测 + CI run `44019318036` |
| CI 实际验证 | run `44019318036`（对应最新已推送 SHA `59cea9d`，PR #1 触发）Typecheck / Test / Build 全绿 | GitHub Actions |
| 发布工作流来源校验逻辑 | 本机用真实 git 数据演练通过：main 自身对 origin/main `--is-ancestor` 为真（允许路径 exit 0），未合并的分支提交 `59cea9d` 为假（阻断路径 exit 1）；workflow YAML 解析通过 | 本机演练；**Tag 触发的实际发布链路尚未执行**（未创建 Tag，不得视为已通过） |
| README 与实际能力 | 已对齐（批次 6）；批次 7–10 修复未改变对外能力面 | 人工核对 |
| 官方覆盖报告 | `OFFICIAL-API-COVERAGE.md` 审计缺口已在批次 3–5 闭环 | 人工核对 |
| 版本号 | `0.1.16`，未改 | 本机读取 package.json |

## 7. 发布工作流门禁（批次 9 补测试与版本校验，批次 10 补来源校验）

`.github/workflows/publish.yml` 当前状态：

1. 仅由 `v*` Tag push 触发；`workflow_dispatch` 已删除，无绕过 Tag 的手动发布入口。
2. 流程依次：Checkout（`fetch-depth: 0` 全量历史）→ **Tag 来源校验**（`git fetch origin main` 后以 `git merge-base --is-ancestor "$GITHUB_SHA^{commit}" origin/main` 验证；Tag 指向未合并 main 的提交时立即失败，不进入任何发布步骤）→ Node 初始化（含 Trusted Publishing 的 npm 升级）→ `npm ci` → **Tag 与 package.json 版本一致性检查** → `npm run typecheck` → `npm test` → `npm run build` → 目标版本是否已发布检查 → `npm publish --access public --provenance`。
3. 任何验证步骤失败即终止，不会到达 publish。
4. 保留 OIDC Trusted Publishing（`id-token: write`），无长期 npm Token；`prepublishOnly` 继续阻止本地 `npm publish` 绕过。
5. 已知限制：OIDC 不能发布包的首个版本，首次发布需一次性用已登录 npm CLI 完成（工作流注释已注明）。
6. 验证状态：四个验收场景中，"Tag 指向未合并分支提交须失败"与"Tag 指向 main 已包含提交须放行"两条路径已在本机用真实 git 数据演练（见 §6）；**Tag 触发的完整发布链路尚未实际执行**——本分支未创建任何 Tag，此项在首次真实发版时才得到运行时验证，不得视为已通过。

## 8. 未解决问题清单

**发布阻断项：无。** Batch 9 修复发布工作流门禁后，当前无已知阻断项。

**已知限制（接受现状，不伪装为已解决）：**

1. 删除任务后承载 Session 不自动清理，会话会遗留。恢复自动清理需产品决策与安全的归属标记，不在本分支处理。
2. OIDC Trusted Publishing 不能发布包的首个版本（npm 平台限制），首次发布需一次性人工登录完成。

**观察项（范围外记录，未修改）：**

1. 旧代码 `primaryAgents()` 空 catch：agent 列表加载失败静默降级为空列表，早于批次 1 存在。
2. `refreshSessions()` 无并发保护。
3. 4xx 中 409 边界未在创建异常分类中单独处理。
4. CI 的 `push` 事件仅监听 main，分支推送不触发 CI；验证依赖 PR #1 的 `pull_request` run。
5. `schedule.get` 仅用于单任务对账；create 失败核对使用 `list({sessionID})`，取舍见 `OFFICIAL-API-COVERAGE.md` §5。

## 9. 发布流程与前置条件

批准发布后的既定路径（需用户另行决定并授权）：

1. 合并 PR #1 到 main（当前**未获最终合并批准**，不自行合并）。
2. 升级 `package.json` 版本号（如 `0.1.17`）。
3. 提交并打 `v*` Tag 推送——publish.yml 由 Tag 触发，自动完成版本校验、typecheck、test、build、已发布检查后以 OIDC 发布。
4. 首个经此链路发布的版本若为"包首版"场景，需一次性人工 npm CLI 发布（见 §7 已知限制）。

在获得最终发布批准前：不合并、不发版、不打 Tag、不建 Release。
