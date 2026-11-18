# Changelog

## 0.2.0 — 2026-11-18

> **破坏性更新 / Breaking change**：本版本底层从 OpenCode 旧的实验性 Schedule API 迁移到官方 **Automation API**，以适配 **OpenCode 2.3.2**。请务必先阅读下方「版本兼容」与「数据迁移」，升级前确认你的环境。

### 版本兼容（必读）

OpenCode 在 **2.3.2** 删除了 `/api/experimental/schedule`，改为 `/api/experimental/automation`，两套 API 不兼容：

| OpenCode 版本（Desktop CLI / `@opencode/*`） | 应使用的插件版本 |
|---|---|
| **2.3.2 及以上** | **0.2.0 及以上**（本版） |
| 2.3.2 之前（如 2.2.5） | **0.1.x**（旧版，请锁定版本） |

- 仍在 2.3.2 之前的用户请继续使用 **0.1.x**，不要升级到本版。
- 已升级到 2.3.2 的用户必须使用 **0.2.0+**；继续用 0.1.x 会因调用已删除的 `schedule.list()` 而报 `Cannot read properties of undefined (reading 'list')`。

### 数据迁移（必读）

- 历史任务由 **OpenCode 宿主在数据库层自动迁移**，不可逆；本插件**不参与任何数据迁移**，只做 Automation 的前台管理。
- **部分历史数据不会迁移，升级后无法由本插件找回**：带 `if` / `until` 条件、`ends.times` 次数限制、已结束、或没有下次触发时间的任务会被宿主直接丢弃。有需要保留的旧任务请在升级前自行导出。
- 新 API 不再支持运行条件门禁与运行次数上限，相关界面与入参已移除。

### 新增与改进

- 接入官方 Automation API（`@opencode/plugin` / `@opencode/client` 升级到 2.3.2）。
- 任务类型完整保留官方两种动作：提示词（prompt）与代码（code），代码任务明确标注，不与提示词混淆。
- 列表改为零参数 `automation.list()` 全局枚举，不再遍历所有会话；会话仅用于补充模型 / Agent / 目录等展示信息。
- 区分创建者 `sessionID` 与执行目标 `action.to`，不再混用两者的语义。
- 完整保留官方字段（`state` / `runCount` / `lastOutput` / `projectID` / `directory` / `time` 等）。
- 弹窗尺寸加大并支持拖拽调整，宽容器下表单自动分栏。
- README 全量更新为 Automation API 说明，并补充版本兼容与数据迁移章节。

### 移除

- 删除官方 Automation API 不支持的旧执行条件：`if` / `until` 运行条件、`ends.times` 次数限制及相关的界面、类型与格式化逻辑。

### 修复

- 修复在 OpenCode 2.3.2 上因 Schedule API 被移除导致的 `Cannot read properties of undefined (reading 'list')`。
- 修复扫描期间删除的任务被全局快照复活的问题。
- 修复 `npm ci` 因 peer 依赖锁文件不一致导致的 EUSAGE 失败。

---

## 0.1.x

旧版（0.1.17 及之前）基于 `experimental.schedule`，适用于 OpenCode 2.3.2 之前的版本。
