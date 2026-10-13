# 停止批次交接 — 2026-10-13

按父线程最新授权，仅将现有改动推送到独立 handoff 分支；不继续实现，不更新原开发分支或 master。此快照不是最终验收。

## 基线与恢复
- 本次独立交接分支：handoff/mixed-project-drafts-20261013；只保存已有改动，不继续实现或合入。
- 直接父提交 checkpoint：31b82bde8de7d096b969bba32f9c473a0bf03284。
- 原开发分支 feat/mixed-project-drafts 不更新；master 不更新。
- 新环境直接获取此 handoff 分支即可恢复 checkpoint 及之后的未提交改动，无需旧容器绝对路径。
- 本目录保存已有验证日志；截图及 trace 在 docs/screenshots/c-project-editor/。

## 已实现但未最终验收
混合工程新增/重命名/删除文件、入口和最后 ASM 保护、严格路径与配额校验；单槽浏览器本地草稿显式保存/恢复、坏草稿与 quota 失败保护、跨页面保留未保存编辑。重命名不自动改写 include/.module/符号。没有新增上传或修改 CSP。

## 现有验证与限制
- 完整单测 691 通过（48 文件，含 native SDCC）；类型、Lint 通过。
- 上述检查之后有两项小改动：序列化前验证输入、编辑后清除旧草稿提示；尚未重跑最终检查。
- 曾通过 9 项定向 Chromium E2E（新工程 3、编译 3、诊断 3）；后续 6 项（新工程 3、编译 3）通过，交接 e2e.log 是后者。
- 全量 78 E2E 尚未运行。本批 dry-run 尚未运行。
- 本地真实浏览器截图捕获成功：编辑/保存/刷新/恢复/编译/加载/运行，CPU P1=11；同源 GET、无请求体、无应用 JS 错误。Vite favicon 404 单独记录。
- 截图/trace/网络行为证据位于 docs/screenshots/c-project-editor/，是本地测试而非现网验收。
- public/sdcc/4.5.0-r1/emuc51-port-source.tar.xz 与 SHA256SUMS 尚未刷新。源码打包脚本已加入新文档路径。
- 未生成本批最终验收 JSON 或最终合入提交。

## 现网限制
此前 diagnostics 批次的正常现网访问遇到 urllib HTTP 403，未保存响应头/正文，无法判断代理或站点原因。之后没有再次访问、换代理、放宽 CSP 或单独部署。本批没有现网通过结论。

## 新任务接续
先获取此 handoff 分支并评审相对 checkpoint 的差异；重跑最终类型/Lint/单测/全量 E2E/构建与 dry-run，刷新 SDCC source archive 和哈希，整理最终证据。只有新任务授权下继续正常开发/合入；此包不代表完成验收或发布授权。

## 最后两项尚未复测的修改（准确位置）
1. src/persistence/c-draft.ts 的 serializeCDraft：JSON.stringify 前先对 draft.input 调用 normalizeCEditorInput，提前执行结构及大小校验；序列化后的 parseCDraft 校验仍保留。
2. src/components/CCompilerPanel.tsx：文件结构变化后清空旧 draftMessage；源码编辑后同时清空旧 draftMessage 和 draftError，避免修改后仍展示过期保存成功或错误提示。
