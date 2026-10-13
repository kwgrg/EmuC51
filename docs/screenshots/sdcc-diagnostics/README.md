# SDCC 构建诊断验收截图

2026-10-13，云环境真实 Chromium，1440×1000 / 390×844。本目录为本地生产构建配同一生产 CSP 的截图，不冒充现网；现网记录单独存放。公开混合工程源码，无图像加工。

- [头文件错误及原始日志](header-diagnostic.png)
- [SDAS 错误列表](asm-diagnostic.png)
- [390px 精确文件/行选区](mobile-location.png)
- [修复、编译、加载、实际运行](repaired-running.png)
- [网络和结果记录](validation.json)、[可回放 trace](trace.zip)

复现：`npm run build && node scripts/capture-diagnostics.mjs`。此脚本从真实头文件错误定位到编辑器，再触发真实 SDAS 错误、修复并运行，核对 word_result=4864。只对本地 Vite 预览自动请求 favicon.ico 的既有 404 记为 environmentNotes；应用错误不忽略，线上模式不允许此例外。

正式 E2E 另覆盖 C 语法列、警告、前序阶段日志、编辑/取消/工作区替换隔离与取消草稿替换。截图是实际流程的证据，不能替代自动断言或跨浏览器验证。
