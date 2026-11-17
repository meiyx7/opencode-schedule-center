# 整体验收报告（批次 6）

本批不加功能，只做回归验证、文档对齐与发布评估。六个批次全部完成，逐批一个独立提交，均已推送。

## 1. 批次与提交

| 批次 | 内容 | Commit |
|---|---|---|
| 基线 | main @ v0.1.16 | `d652103` |
| 1 | 安全与可靠性修复 + 整体审核 | `5a23f24`、`f564129`（审核收尾） |
| 2 | 官方 API 覆盖审计 | `c657592` |
| 3 | 创建参数补齐（tz / ends / if / until / Cron 重定位） | `1756275` |
| 4 | 数据展示一致性（官方字段 / 状态文案 / 官方类型复用） | `862ed1b` |
| 5 | 生命周期操作与按需对账（get / agent 回读） | `6899f72` |
| 6 | 整体验收与文档对齐 | 本提交 |

分支：`fix/schedule-safety-batch1`。未合并 main、未发 npm、未建 Tag/Release、版本仍为 `0.1.16`。

## 2. 功能验收

对照总纲最终验收清单，逐条核对实际代码：

| 验收项 | 结论 | 依据 |
|---|---|---|
| 四种触发方式均能正确创建 | 通过 | `form.tsx` draft 四种；`store.ts:257` 按 kind 映射 in/at/every/cron；批次 3 测试覆盖 |
| 时区参数正确传递 | 通过 | 四种 when 均可选 tz，`store.ts` 原样透传；批次 3 测试断言 `in` 的 tz 不再被省略 |
| 任务名称与 Prompt 正确传递 | 通过 | `store.ts:257` create 传 name/prompt |
| ends 三种参数正确传递 | 通过 | `buildEnds()` 产出互斥的 times/after/at；批次 3 测试三种各断言 |
| if / until 按官方结构传递 | 通过 | `buildCondition()` 产出无 `type` 判别字段的官方入参结构；批次 3 测试断言 |
| 列表数据与官方返回一致 | 通过 | 全部字段直接取官方 `ScheduleInfo`，类型复用 SDK 导出，无本地镜像 |
| 状态与结果分别展示 | 通过 | status 徽章与 lastOutcome 徽章并列；7 个 outcome 各有明确文案（批次 4 测试） |
| 暂停 / 恢复 / 删除遵循官方接口 | 通过 | 均调官方接口、用官方返回值更新缓存、失败保留原状态（批次 5 测试） |
| 跨 Session 聚合完整且有失败提示 | 通过 | cursor 分页 + 100 页上限标记 truncated + 失败会话记录原因；批次 1 测试 |
| 无删除 Session 行为 | 通过 | `remove()` 只调 schedule.delete；批次 1/5 测试断言 session.remove 未被调用 |

## 3. 可靠性验收

| 验收项 | 结论 | 依据 |
|---|---|---|
| 并发扫描不覆盖本地更新 | 通过 | `mutationSeq` 比对，扫描期间的 pause/resume/create/delete 不被旧结果覆盖（批次 1） |
| 并发创建不产生重复任务 | 通过 | 表单同步守卫 + store 按 draft 指纹单飞；不同草稿可并发（批次 1/3 测试） |
| 超时与未知结果不误回滚 | 通过 | create 异常先 `schedule.list` 核对；超时/核对失败一律保留会话（批次 1） |
| 分页截断不伪装完整 | 通过 | 达上限仍有 next 时返回 `truncated=true`，页面明确提示（批次 1） |
| 部分失败不清空任务 | 通过 | 失败会话保留旧缓存条目并记录原因（批次 1） |
| SDK 异常不造成错误状态展示 | 通过 | 首次失败显示"状态暂不可确认"而非空列表；后台失败保留上次数据（批次 1 审核收尾） |
| 刷新无明显闪烁或空数据 | 通过 | `scan-coordinator` 单飞 + 成功后统一提交，不清空已有数据（批次 1） |
| 操作失败按需核对 | 通过 | `reconcile()` 用官方 get 只核对单任务，不重扫全会话（批次 5） |

## 4. 架构验收

| 验收项 | 结论 | 依据 |
|---|---|---|
| 无自研调度器 | 通过 | 全仓无调度循环；定时器仅用于 UI 倒计时、30 秒可见态刷新、combobox 防抖、复制反馈 |
| 无自研 Cron 执行器 | 通过 | `format.ts` 的 cron 解析仅作描述与参考预览，标注"预计/仅供参考"，不作创建门禁、不作 nextDueAt |
| 无本地任务库 / 持久化 | 通过 | grep 无 localStorage/IndexedDB/文件写入 |
| 不自维护执行次数与生命周期 | 通过 | runCount/remainingRuns/endsAt/status 全取官方 |
| 官方数据优先，不重复维护状态 | 通过 | 类型直接复用 SDK 导出；pause/resume 用官方返回值 patch 缓存 |
| 无必要外新抽象 | 通过 | 仅保留 `scan-coordinator`（解决单飞刚需）；条件编辑器为一个复用的小组件 |
| 无立即执行 / 编辑接口 | 通过 | API 未提供，插件未伪造 |

## 5. 工程验收

| 项目 | 结果 |
|---|---|
| `npm run typecheck` | 通过，0 错误 |
| `npm test` | 通过，53/53（8 个 suite，零新依赖，全部 Mock client） |
| `npm run build` | 通过，单文件 `dist/gui-experimental.cjs`（107.47 kB / gzip 29.85 kB） |
| CI 配置 | `.github/workflows/ci.yml` 含 Typecheck / Test / Build；PR 触发。本次仅在分支 push，未触发 PR Run（符合预期） |
| README 与实际能力 | 已对齐：数据源含 get、职责边界、时区、ends、if/until、cron 参考预览、回滚语义、npm test |
| 官方覆盖报告与代码 | `OFFICIAL-API-COVERAGE.md` 审计的缺口已在批次 3-5 逐项闭环 |
| 未处理 TODO / 静默吞错 | 本轮新增代码无 TODO；无静默吞错（switch 失败均有提示与回滚） |
| 版本号 | 0.1.16，未改 |

## 6. 遗留问题与观察项

1. **承载会话遗留**：删除任务后不再自动删除挂载会话。标题不是所有权标识，且禁则禁止批量清理与新增持久化标记——恢复该能力需独立产品决策。
2. **`schedule.get` 未做全量核对**：只用在对账单任务。create 失败时因无 scheduleID，用 `list({sessionID})` 核对，取舍已在审计报告 §5 说明。
3. **旧的 `primaryAgents()` 空 catch**：agent 列表加载失败静默降级为空列表——批次 1 之前就存在的代码，不属本轮范围，仅记录不改。
4. **CI Run**：本次六批均为分支 push，CI 的 `push` 事件仅监听 main，故无 CI Run 记录；`pull_request` 会在开 PR 时触发。

## 7. 发布评估

- 代码与文档已达总纲验收标准，功能/可靠性/架构/工程四类验收全部通过。
- 按约定**不合并 main、不发布 npm、不创建 Tag/Release**——等待整体审核后再定。
- 六批次均为独立提交并已推送远端 `origin/fix/schedule-safety-batch1`；工作区干净（仅本验收报告待提交）。
