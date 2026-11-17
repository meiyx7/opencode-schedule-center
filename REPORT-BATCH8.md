# Batch 8 · 模型与 Agent 创建确认逻辑修复报告

## 基线

| 项 | 值 |
|---|---|
| 仓库 | meiyx7/opencode-schedule-center |
| 分支 | `fix/schedule-safety-batch1`（未在 main 开发，未合并 main） |
| 基线 HEAD | `444c416e4226d2eebd0d5b81ae11efe0951851a8` 的父提交 `085495c` |
| 版本 | `0.1.16`（未改动） |
| 本批性质 | 只修创建任务时 model / agent 确认缺陷，不新增功能、不改 UI、不改官方 API 调用语义 |

## 1. 修改文件与原因

| 文件 | 改动 | 原因 |
|---|---|---|
| `src/store.ts` | `createOnce()` 的 model/agent 确认状态初始化与回读合并；新增 `confirmedSession`；`commitCreated()` 删除 `draft` 参数；`reconcileCreate()` 传已确认 Session | TASK-11 / 12 / 13 |
| `test/store.test.mjs` | 新增 11 项独立回归测试（独立 describe 块） | 覆盖两条确认路径与缓存元数据 |

未改动 UI、版本号、官方 API 调用语义、`scan-coordinator`、`form.tsx`、`format.ts`。

## 2. 根因与修复方式

### TASK-11 model 确认状态初始化错误
- **根因**：`modelConfirmed = !draft.model`。当 `session.create()` 直接返回的 model 已与指定值一致时，不进入 switch 分支，标志保持 `false`，随后 `if (draft.model && !modelConfirmed)` 误判为"无法确认"，把一次完全成功的创建安全回滚掉。
- **修复**：初始化改为 `!draft.model || sameModel(session.model, draft.model)`——
  1. 未指定 model：`true`，无任何切换/回读。
  2. 已指定且创建响应已匹配：`true`，跳过 switchModel，不再回读、不再回滚。
  3. 已指定但缺失或不匹配：进入 `switchModel` + `session.get` 回读确认。
- **切换路径**：以 `session.get` 服务端回读结果为准（`sameModel(verify.model, draft.model)`），不凭 switchModel 请求成功认定生效；回读失败（catch）或仍不匹配 → 走原有 `rollbackSession` 安全回滚后抛错。

### TASK-12 Agent 确认状态初始化错误
- **根因**：与 TASK-11 相同（`agentConfirmed = !draft.agent`）。
- **修复**：对称改为 `!draft.agent || session.agent === draft.agent`。直接匹配即确认；不匹配才 `switchAgent` + `session.get`，以回读 `verify.agent === draft.agent` 为准；失败或不匹配保留原有回滚。

### TASK-13 创建结果元数据一致性
- **根因**：`commitCreated()` 用 `...(draft.model ? { model: draft.model } : {})` 把用户请求值直接覆盖进缓存；agent 无同等处理。若服务端实际接受的值与请求值结构不同（例如服务端返回带 name 的完整 ModelRef），缓存写的是请求对象而非服务端实际状态；且 create 失败后走 `reconcileCreate` 认领的路径无法获得回读确认值。
- **修复**：
  1. `createOnce()` 维护 `confirmedSession`，初始为 create 响应；仅当 switch 后回读确认成功时，把 `verify.model` / `verify.agent` 合并进去（只取对应字段，不整体覆盖，保留 `location` 等其他元数据）。
  2. `commitCreated(session, schedule)` 删除 `draft` 参数，直接存储传入的已确认 Session，不再用请求值覆盖。
  3. `reconcileCreate()` 也接收 `confirmedSession`，认领路径与正常路径元数据同源。
  4. 零新增网络请求：复用确认流程中已经发生的 `session.get`；未指定 model/agent 时不产生任何额外调用。

## 3. 新增测试覆盖场景（11 项）

| 场景 | 断言要点 |
|---|---|
| 创建响应 model 已匹配 | 创建成功；`switchModel` 0 次；`session.get` 0 次；无 remove |
| 创建响应 Agent 已匹配 | 创建成功；`switchAgent` 0 次；`session.get` 0 次；无 remove |
| model 不匹配，切换后回读匹配 | 创建成功；`switchModel` 1 次；无 remove |
| Agent 不匹配，切换后回读匹配 | 创建成功；`switchAgent` 1 次；无 remove |
| model 切换请求失败 | 抛"无法确认模型"；remove 1 次；schedule.create 未调用 |
| Agent 切换请求失败 | 抛"无法确认 Agent"；remove 1 次；schedule.create 未调用 |
| model 切换后回读仍不匹配 | 抛"无法确认模型"；remove 1 次；schedule.create 未调用 |
| Agent 切换后回读仍不匹配 | 抛"无法确认 Agent"；remove 1 次；schedule.create 未调用 |
| 未指定 model / Agent | 不触发 switchModel / switchAgent / session.get 任何多余调用 |
| 直接接受路径的缓存元数据 | `row.session.model` 与服务端返回对象**引用相等**（`assert.equal`），且 `notEqual` 请求对象 |
| 切换路径的缓存元数据 | model/agent 来自回读确认值；`location.directory` 不因回读合并丢失；`session.get` 恰好 2 次（model 与 agent 各一次） |

覆盖要求满足：两条路径（创建直接返回正确值 / 需要切换后才正确）各有成功与失败用例。

## 4. 验证结果（本机实测）

| 步骤 | 结果 |
|---|---|
| `npm run typecheck` | 通过，0 错误 |
| `npm test` | 96/96 通过（原 85 + 新增 11），13 个 suite，0 失败 |
| `npm run build` | 通过，`dist/gui-experimental.cjs` 108.55 kB / gzip 30.27 kB |

## 5. Git 状态

| 项 | 值 |
|---|---|
| 本批提交 | `444c416e4226d2eebd0d5b81ae11efe0951851a8`（fix: confirm model and agent from session read-back (batch 8)） |
| 已推送 | `origin/fix/schedule-safety-batch1` |
| 相对 main | ahead 9 / behind 0 |
| CI | PR #1 由本提交触发的 run `44017866072`：Typecheck / Test / Build 全绿 |
| 未做动作 | 未合并 main、未发 npm、未改版本号、未建 Tag/Release、未新建 PR |

## 6. 范围外记录（未处理）

1. 删除任务后承载 Session 不自动清理——需产品决策（延续既有记录）。
2. `refreshSessions()` 无并发保护——本批未触及。
3. `primaryAgents()` 旧空 catch——批次 1 之前即存在，仅记录。
4. 4xx 中 409 边界未在异常分类中单独处理。
