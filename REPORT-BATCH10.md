# Batch 10 · 发布 Tag 来源校验报告（材料由 Batch 10.1 同步入库）

本报告记录 Batch 10（提交 `db1ee38a94b7bc5df683960259cccd6dc722f05a`）实际完成的工作。Batch 10.1 仅补充本报告与验收材料同步，零代码改动。

## 基线

| 项 | 值 |
|---|---|
| 仓库 | meiyx7/opencode-schedule-center |
| 分支 | `fix/schedule-safety-batch1`（未在 main 开发，未合并 main） |
| 基线 HEAD（批次 9） | `59cea9d01a581d711ac390919bfa900ac36a8ad3` |
| 本批提交 | `db1ee38a94b7bc5df683960259cccd6dc722f05a` |
| 版本 | `0.1.16`（未改动） |
| 本批性质 | 只补充发布来源保护与验收材料，不改变业务功能、不改业务代码 |

## 1. 修改文件与原因

| 文件 | 改动 | 原因 |
|---|---|---|
| `.github/workflows/publish.yml` | checkout 加 `fetch-depth: 0`；新增首道门禁步骤 | Tag 来源校验 |
| `FINAL-ACCEPTANCE.md` | 批次表、ahead 状态、CI 记录、验证渠道区分、来源校验说明 | 同步最终验收材料 |

未改动：任何业务代码（`src/`、`test/`）、版本号、`ci.yml`、Trusted Publishing 配置；未新增功能、抽象或测试。

## 2. Tag 来源校验逻辑

发布工作流新增的首道门禁（位于 Node 初始化与 `npm ci` 之前，失败即快速终止）：

```bash
git fetch origin main
sha="$(git rev-parse "$GITHUB_SHA^{commit}")"
if ! git merge-base --is-ancestor "$sha" origin/main; then
  exit 1   # Tag 指向的提交未合并进 main，拒绝发布
fi
```

- `fetch-depth: 0`：checkout 拉取完整历史，`merge-base --is-ancestor` 才有足够的图数据。
- `git fetch origin main`：发布前获取最新 origin/main，不依赖 checkout 时刻的陈旧引用。
- `git rev-parse "$GITHUB_SHA^{commit}"`：剥离可能的 Tag 对象，确保拿到提交 SHA。
- `git merge-base --is-ancestor`：验证 Tag 指向提交是否可从 origin/main 到达；不可到达时 exit 1，工作流在进入任何发布步骤之前失败。
- 原有门禁全部保留：Tag 与 package.json 版本一致性、`npm ci`、typecheck、test、build、已发布版本检查；`workflow_dispatch` 保持删除状态，无手动发布入口；OIDC Trusted Publishing 配置不变。

## 3. 本机 Git 场景演练结果（真实仓库数据）

| 场景 | 命令 | 结果 |
|---|---|---|
| Tag 指向 main 已包含的提交 → 放行 | `git merge-base --is-ancestor origin/main origin/main` | exit 0 |
| Tag 指向未合并分支提交 → 阻断 | `git merge-base --is-ancestor 59cea9d origin/main` | exit 1（分支尚未合并，正是真实阻断状态） |
| 工作流 YAML 语法 | `yaml.safe_load(publish.yml)` | 解析通过 |

## 4. GitHub CI 结果

| 项 | 值 |
|---|---|
| Run | `44020160902` |
| 对应提交 | `db1ee38`（Batch 10 代码提交；Batch 10.1 `7ebc9c1` 与 10.2 为后续文档提交） |
| 事件 | `pull_request`（PR #1 触发） |
| 结果 | success，Typecheck / Test / Build 全部通过 |

## 5. 验证渠道声明（重要边界）

- **当前 CI 是 PR CI**：run `44020160902` 由 `pull_request` 事件触发，验证的是 typecheck/test/build 与业务代码，**不代表 Tag 触发的发布工作流（publish.yml）已经实际运行**——`pull_request` 事件不会触发 publish 工作流。
- **Tag 发布链路尚未实际执行**：本分支未创建任何 Tag，来源校验门禁、版本一致性校验与 OIDC 发布步骤的组合行为仅在首次真实发版时得到运行时验证。本机演练只证明校验命令逻辑与 YAML 语法正确，**不得标记该链路为已通过**。
- 后两个验收场景（Tag 版本与 package.json 不一致须失败、测试或构建失败须终止发布）由保留的原有步骤结构保证，同样属于未运行的发布链路部分。

## 6. 严格边界确认

- 零业务代码改动：`src/`、`test/` 无任何变更。
- 版本号仍为 `0.1.16`。
- 未合并 main、未创建 Tag、未创建 Release、未发布 npm。
- 未新增功能、抽象或测试框架。
- 相对 main：批次 10 推送后 ahead 11 / behind 0；Batch 10.1 材料同步提交推送后 ahead 12 / behind 0。
