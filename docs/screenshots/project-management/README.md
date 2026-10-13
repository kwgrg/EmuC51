# 工程管理浏览器验收截图

2026-10-13，真实 Chromium、本地生产构建与生产 CSP。不是生产站点截图。

- [桌面工程文件与草稿](desktop.png)
- [390 × 844 窄屏工程管理](mobile.png)
- [新建 C/头文件/ASM，修复引用后实际运行 result=27](running.png)

复现：`npm run build` 后执行 `EMUC51_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- --project=chromium tests/e2e/c-project-management.spec.ts`。测试直接截图，没有图片加工。完整验证记录见 [本批证据](../../evidence/project-management-2026-10-13/validation.json)。
