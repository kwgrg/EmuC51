# 本轮复测的工程草稿截图与网络记录

2026-10-13，接续任务采用交接分支提供的 `scripts/capture-project-editor.mjs`，对最终本地生产构建重新执行。旧截图未用于本轮验收。生产 CSP 下真实 Chromium，桌面 1440×1000、窄屏 390×844。

- [工程管理](desktop-project.png)、[窄屏](mobile-project.png)
- [显式恢复草稿，CPU 仍未加载](restored-draft.png)
- [多文件编译运行 P1=11](compiled-runtime.png)
- [网络请求及断言结果](validation.json)、[本轮 trace](trace.zip)

运行 `npm run build && node scripts/capture-project-editor.mjs` 复现。只访问本地预览地址；无生产站点请求，无源码上传。另一个新增工程和失败修复流程见[工程管理截图](../project-management/README.md)。
