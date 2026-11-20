# AGENTS.md — opencode-schedule-center

## 0. 必读：通用工程规范

**开始前必须先读取并遵守上级目录的规范唯一来源：**

```
/Users/meiyx/workspace/others/opencode-plugins/AGENTS.md
```

该文件是《插件工程开发、测试与发布规范》v1.0（2026-11-18）的唯一副本，包含十节完整约束。
本文件只记录本项目差异信息，不重复规范正文。规范更新只改上级文件。

## 1. 项目速查

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/meiyx7/opencode-schedule-center.git |
| npm 包名 | `opencode-schedule-center` |
| 当前版本 | `0.2.1` |
| 默认分支 | `main` |
| 入口导出 | `./gui-experimental` → `dist/gui-experimental.cjs` |
| 源码验证 | `npm run test`、`npm run typecheck` |
| 构建 | `npm run build`（vite build） |
| 打包 | `npm pack --dry-run` → `npm pack` |
| 发布钩子 | `prepublishOnly`（ensure-ci-publish + build） |

> 上表命令以本仓库 `package.json` 为准；上级规范中的命令为通用表述，实际执行以本表为准。

## 2. 验收环境约定（执行第三层验证前填写）

- 独立 OpenCode 配置目录：`~/.config/opencode-acceptance/schedule-center`（需确认）
- 独立插件安装目录：与开发环境的插件安装目录分离，不得共享状态
- 禁止用本地软链接或源码目录冒充安装结果，必须安装实际生成的 `.tgz`
- 无法完全隔离时，须在测试记录中写明隔离边界及可能影响结果的因素

## 3. 本项目专项提示

- GUI 插件：涉及界面改动时必须在真实 OpenCode Desktop 中验证 Dialog 入口、设置面板、不同内容区域宽度、页面滚动及交互状态变化。
