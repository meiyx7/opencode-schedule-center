# 定时任务插件迭代 · 第一批交付报告

分支：`fix/schedule-safety-batch1`（基线 `main` @ `d652103`，tag v0.1.16）
范围：数据安全与核心可靠性修复。未增加产品功能、未改 UI 结构、未改版本号、未发 npm、未建 Tag、未合并 main。

---

## 1. 修改清单

| 文件 | 修改函数 / 区域 | 修改目的 |
|---|---|---|
| `src/store.ts` | `ListResult`、`SessionFailure` | 结果模型由单一计数改为 `failures[]` + `truncated`，让不完整状态可识别 |
| `src/store.ts` | `fetchAllSessions` | 按官方 cursor 分页；100 页安全上限仍有 next 时标记 truncated |
| `src/store.ts` | `listAll` | 局部构建、成功后原子提交；`mutationSeq` 防止扫描覆盖期间的新写入；truncated 时保留未扫描会话的旧数据 |
| `src/store.ts` | `createSchedule` / `createOnce` | 按 draft 指纹单飞；明确失败与结果未知分流；模型未生效时等待回滚 |
| `src/store.ts` | `reconcileCreate` | 用官方 `schedule.list({sessionID})` 核对；命中认领、明确失败才回滚、超时/核对失败一律保留会话 |
| `src/store.ts` | `rollbackSession` | `await` 回滚；失败携带回滚原因与原错误抛出 |
| `src/store.ts` | `patchLocal` / `commitCreated` / `remove` | 本地写入递增 `mutationSeq`；`remove` 只调官方 Schedule Delete，不再按标题删会话 |
| `src/store.ts` | `draftKey` / `isIndeterminateError` | 重复提交识别；区分超时/网络错误与业务拒绝 |
| `src/scan-coordinator.ts` | 新增 | 扫描单飞、多入口复用、首次/后台失败区分（无 UI 依赖，便于测试） |
| `src/gui/page.tsx` | `load` / `coordinator` | 接入单飞；展示部分失败与分页截断；后台失败不清除上一条错误；修正删除按钮文案 |
| `src/gui/form.tsx` | `submit` | 同步 `submitting` 守卫，补足 signal 批处理窗口 |
| `package.json` | `scripts.test` | esbuild 编译 + `node --test`，零新依赖 |
| `.github/workflows/ci.yml` | Test step | CI 增加自动化测试 |
| `.gitignore` | `test/.build/` | 忽略测试编译产物 |
| `test/store.test.mjs` | 新增 | 29 项 Mock 测试 |
| `test/scan-coordinator.test.mjs` | 新增 | 7 项单飞测试 |

---

## 2. 问题闭环报告

### TASK-01 删除任务时的会话误删除风险

- **原始问题**：`remove()` 用 `session.title?.startsWith("定时任务")` 判断归属并删除会话。
- **原因**：显示标题不是资源所有权标识；改名、共享会话、多任务共用会话都会误判。
- **修复**：`remove()` 只调用官方 `experimental.schedule.delete({scheduleID})` 并同步本地缓存；完全不发起 `session.remove`。保留可选第二参数以兼容既有调用方。
- **对应测试**：普通会话不删 / 改名会话不误删 / 同会话多任务删除隔离 / 删除失败保留任务，共 4 项。
- **验收**：通过。删除请求数与任务数一致，会话删除请求恒为 0。

### TASK-02 创建失败后的回滚机制

- **原始问题**：`void session.remove().catch(() => undefined)` 不等待、吞异常；超时可能留下孤儿任务；重复提交产生重复任务。
- **原因**：失败与结果未知未区分；回滚未纳入 await 链；无提交去重。
- **修复**：
  - Session 创建失败：直接抛出，无资源可回滚。
  - 模型未生效：`await rollbackSession()` 后抛错，回滚失败带明确信息。
  - Schedule 明确失败（业务错误 + list 确认空）：`await` 回滚后抛原错误。
  - 超时 / 请求结果未知：`schedule.list({sessionID})` 核对；命中则认领任务并保留会话；空列表也不删会话（读延迟可能隐藏已创建的任务）；核对本身失败同样保留会话并明确报错。
  - 重复提交：表单同步 `submitting` + store 按 draft 指纹单飞；不同草稿并发不会被吞掉。
- **对应测试**：Session 创建失败、明确失败、超时已创建、响应丢失、回滚成功、回滚失败、重复提交、不同草稿并发、核对失败、超时空列表、模型未生效，共 11 项。
- **验收**：通过。明确失败无遗留可回滚资源；超时场景承载会话保留；无重复任务；所有异常路径均有明确结果。

### TASK-03 全会话扫描分页完整性

- **原始问题**：固定 100 页 × 200，达到上限仍有下一页时静默返回。
- **原因**：安全上限被当作终止条件而非不完整信号。
- **修复**：按官方 cursor 推进，`cursor.next` 为空即终止；第 100 页仍有 next 时 `truncated=true`；页面显式提示；truncated 时保留未扫描会话的旧缓存行，不静默丢弃。并发查询仍为每批 20 个会话。
- **对应测试**：0 会话 / 不足一页 / 恰好一页 / 多页 / 超 20,000 模拟 / 中间页失败 / 分页期间数量变化 / 截断保留旧数据，共 8 项。
- **验收**：通过。官方接口无快照一致性，报告与 UI 均不声称强一致，只保证可识别的不完整状态。

### TASK-04 全量扫描单飞机制

- **原始问题**：初始加载、30 秒轮询、手动刷新、操作后对账同时触发全量扫描，导致重复请求与闪烁。
- **原因**：四个入口各自直接调用 `listAll()`，无在飞合并。
- **修复**：`createScanCoordinator` 合并所有入口到同一在飞 Promise；失败不清空 rows；首次失败才显示阻塞错误，后台失败保留数据且不清除上一条错误；成功后统一提交。
- **对应测试**：连续刷新 / 自动+手动 / 旧请求不覆盖新请求 / 首次失败 / 后台失败 / 重试语义 / busy 归位，共 7 项。
- **验收**：通过。未引入状态管理框架。

### TASK-05 完善部分失败处理

- **原始问题**：全局聚合依赖多会话查询，单会话失败可能被当成无任务。
- **原因**：计数不携带失败会话身份；扫描开始即清空缓存。
- **修复**：局部构建缓存、成功后原子提交；失败会话记录 `sessionID` + 原因并保留旧任务；不因部分失败清空全部、不触发任何删除/修改；下一轮成功恢复完整状态。
- **对应测试**：单会话失败 / 多会话失败 / 全部失败 / 旧任务保留 / 后续恢复 / 无删改动作，共 6 项。
- **验收**：通过。

---

## 3. 测试报告

| 项目 | 结果 |
|---|---|
| TypeScript 检查（`npm run typecheck`） | 通过，0 错误 |
| Build（`npm run build`） | 通过，`dist/gui-experimental.cjs` 95.99 kB / gzip 26.87 kB |
| 自动化测试（`npm test`） | **36 / 36 通过**，5 个 suite，0 失败 / 0 跳过 |
| 异常场景 | 超时、响应丢失、回滚失败、核对失败、中间页失败、部分失败、扫描期间暂停、安全上限截断，全部有明确结果 |
| 未通过项目 | 无 |
| 测试基础设施 | 零新依赖：esbuild（已有 devDependency）编译 + Node 内置 `node:test`；全部使用 Mock client，不依赖真实用户数据 |

---

## 4. 代码审查报告

独立第三方审查（只读）结论：**未发现阻断性严重缺陷**。六项重点检查如下：

| 检查项 | 结论 |
|---|---|
| 不必要的抽象 | `scan-coordinator.ts` 仅一处消费，但为 40 行可测逻辑，不构成通用框架 |
| 重复状态 | 页面 `primed` = 首次尝试结束；协调器 `primed` = 首次成功过。职责分别为 UI 与逻辑，语义不同但自洽 |
| 资源泄漏 | 无新增泄漏；Promise 在 finally 归位，回滚均 await，定时器清理未改 |
| 异步竞态 | 审查发现 2 处，均已修复（见下） |
| 原有功能改变 | 删除任务不再清理承载会话（见记录项）；其余功能入口与交互未变 |
| 兼容性 | `ListResult` 为内部 export 类型，仅页面与测试消费且已同步；`remove` 第二参数保留；任务数据结构未变 |

**审查中发现并已修复：**

1. 超时/核对为空即删会话可能制造孤儿任务 → 改为超时类错误一律保留会话（违反 TASK-02，必须修）。
2. 扫描结束的原子提交会覆盖扫描期间的 pause/resume/create/delete → 增加 `mutationSeq`，较新本地写入优先。
3. 不同草稿并发提交被单飞吞掉（Dialog 与设置页共享 store 单例）→ 单飞键改为 draft 指纹。
4. 后台刷新失败会清空上一条操作错误 → 保留原错误。
5. 截断时未扫描会话的旧缓存行被静默丢弃 → 保留旧行并提示。

**记录但不修改（超出本批次范围）：**

- **承载会话遗留**：删除任务后本插件创建的空会话不再自动清理。禁则禁止「批量清理历史会话」，且本批次禁止新增持久化标记体系，因此不做带身份标记的清理。如需恢复该能力，应作为独立产品决策与独立批次处理。
- **`ListResult` 字段变更**：`failedSessions: number` → `failures[]` + `truncated`。全仓消费方已同步；若外部 widget 依赖旧字段需在下个版本按 semver 处理。
- **`remove` 第二参数**：保留但忽略，避免破坏既有调用方。
- **既有 `page.tsx` ref 清理返回值冗余**：属既有代码，不顺手修改。

---

## 5. Git 状态

- 分支：`fix/schedule-safety-batch1`，基于 `main` @ `d652103`
- 提交：本批次改动与本报告已提交（commit 见 `git log -1`）
- 工作区：干净
- 未合并 `main`；未发布 npm；未创建 Tag / Release
- 完成后停止，等待整体审核；未开始第二批
