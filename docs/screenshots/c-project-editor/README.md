# 混合工程文件管理 / 本地草稿 · 真实浏览器证据

2026-10-13，云环境 Chromium。当时的本地生产构建及原生产 CSP（早于最后两项尚未复测的修改，不代表交接快照最终验收）；不是现网截图，未重试此前 HTTP 403。

- [桌面工程与已保存草稿](desktop-project.png)
- [390px 文件管理](mobile-project.png)
- [刷新后显式恢复](restored-draft.png)
- [实际编译与运行](compiled-runtime.png)
- [网络/行为记录](validation.json) · [Playwright trace](trace.zip)

`npm run build && node scripts/capture-project-editor.mjs` 可复现：从 C/SDAS 示例新增头文件和 C、入口改名，显式保存、刷新恢复，再真实编译/加载/运行，断言 P1=11。localStorage 记录只含 format/version/input/selected，没有 CPU 状态。请求均为本地同源 GET，无请求体；已知本地 Vite favicon.ico 404 单独记录为 environmentNotes。

正式 E2E 另覆盖 ASM/头文件改名后的引用修复、删除取消、受保护入口/最后一个 ASM、草稿损坏和配额、结构变化后的旧结果隔离以及清除失败时 CPU 仍可单步。没有声称实现跨标签协作、任意工程配置或非 Chromium 引擎。
