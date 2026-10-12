# EmuC51 页面风格前后对照

2026-10-12，实际云环境 Chromium 截图，无图片加工。参考 [ChatGPT 网页](https://chatgpt.com/) 的中性、克制视觉语言，保留 EmuC51 的编译与调试结构。保留现有固定深色主题，没有加入主题持久化或安全策略变更。

修改前基线：`41c41c0157da8356e2f288a70060f332d225c94f`。空工作区对照采用相同视图与尺寸。桌面 1440×1000，平板 820×1024，手机 390×844；另有 1280px 自动布局测试。

| 页面 | 修改前 | 修改后 |
| --- | --- | --- |
| 首页 | [截图](before-home.png) | [截图](after-home.png) |
| 编译/调试 | [截图](before-editor.png) | [截图](after-editor.png) |
| 内存 | [截图](before-memory.png) | [截图](after-memory.png) |
| 外设 | [截图](before-io.png) | [截图](after-io.png) |
| 平板 | [截图](before-tablet.png) | [截图](after-tablet.png) |
| 手机 | [截图](before-mobile.png) | [截图](after-mobile.png) |

实际 C + SDAS 编译、加载、运行 1000 个执行单元后的 [调试工作台](after-mixed-debug.png) 与 [内存表](after-loaded-memory.png)，不是模拟状态。

视觉复核覆盖标题/工具栏、寄存器、等宽内存列、断点与 PC 行、外设场景表单、手机控件换行和底栏。移除了扫描线、背景网格和装饰荧光，提高小字号可读性，修正底栏文字重叠。新增侧栏折叠只影响布局；折叠不卸载编辑器，不改变 CPU 或编译产物身份。错误提示保留关闭按钮，文件选择仍使用浏览器原生对话框；本应用没有自定义模态弹窗。

复现修改后截图：

```sh
npm run build
EMUC51_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node scripts/capture-workbench.mjs after
```

截图脚本只访问本地预览，使用生产 CSP；正式功能回归由完整 Chromium E2E 覆盖。Firefox/WebKit 未验证。最终检查结果见 [验证记录](../../evidence/neutral-workbench-validation.json)。
