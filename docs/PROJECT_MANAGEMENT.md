# 混合工程文件管理与本地草稿

2026-10-13。独立参考 µVision 的 [Creating Projects](https://www.keil.com/support/man/docs/uv4cl/uv4cl_ca_createproject.htm) 和 [Build the Project](https://www.keil.com/support/man/docs/uv4cl/uv4cl_ca_buildproject.htm) 公共流程；未复制其专有代码或素材。当前采用固定 SDCC 4.5 工具链、全量 Worker 构建，没有 µVision 多 target、文件分组、增量依赖构建或 C51 编译器兼容承诺。

## 操作与生命周期

在 C/SDAS 编辑面板展开「工程管理与本地草稿」。混合工程可从示例或已加载的工程开始：

- 新增 `.c`、`.h`、`.asm`，同类型改名、删除，以及选择定义 `main` 的 C 入口。
- 当前入口不能删除；先选择另一 C 入口。协议要求至少保留一个 ASM，最后一个 ASM 不能删除。入口改名同步更新清单，保持内容原样。
- 改名/删除不自动改写 `#include`、`.module`、链接符号，操作前提示用户手动修复。新 ASM 初始化与文件 stem 一致的 `.module`；改名后需自行修改。
- 头文件目录自动添加至有界包含目录，空目录移除；其余目录维持原搜索次序。
- 页面内切换 BIN_INSPECTOR / SYS_MEM / I/O_PORTS 保留编辑和文件选择，编译产物及诊断不跨面板卸载保留。切换 CPU 固件不覆盖草稿。
- 内容或工程结构变化、重新构建、取消使旧产物及诊断失效。失败后不可加载上次成功结果；仍需成功构建后显式加载。

草稿使用单独的 localStorage 槽 `emuc51.c-draft.v1`，只保存版本、清单、源码及文件选择，不含 CPU、固件、诊断或构建产物。单 C 草稿也可保存。保存是显式操作，刷新后点击「恢复本地 C/SDAS 草稿」；不自动编译、加载或运行。CPU 工作区自身原有刷新恢复行为不变。

删除文件、替换有修改的草稿、覆盖另一份已保存草稿均先确认，取消保留当前编辑。未保存编辑有关闭页面提示（由浏览器决定是否显示）。保存成功后才更新保存状态。损坏/不支持版本/超限/存储拒绝均显示错误，保留当前编辑和原存储内容；读取失败不当作空草稿。CLEAR_LOCAL 同时清除 CPU 工作区和两类源码草稿，未保存 C/SDAS 编辑先确认。

## 输入边界

继承混合工程协议：最多 16 源文件、16 头文件、8 包含目录；每文件 65536 字符和 8192 行，总源码 512 Ki 字符；保存 JSON 含 UTF-8/转义后最大 2 MiB。编辑超限不应用，明确显示错误。仅规范 ASCII 相对路径，basename 忽略大小写唯一，源模块 stem 忽略大小写唯一，保留 `firmware` 模块名；不接受绝对路径、穿越、反斜杠和不同类型改名。允许显式大小写改名，但不自动修复引用大小写。

草稿可保存暂时不合法的 C/ASM，结构与大小仍必须合法。结构验证不等于编译成功，也不猜 `main` 定义；真实构建核验入口、`.module`、头文件和链接。

## 验证与限制

`tests/core/c-project-editor.test.ts`、`tests/persistence/c-draft.test.ts` 验证原子结构操作、数量/大小/路径上限及存储失败。`tests/e2e/c-project-management.spec.ts` 在生产构建、生产 CSP 的真实 Chromium 下验证新增三类文件、入口切换、引用失败修复、实际运行 result=27，以及跨页面/刷新、确认取消、损坏/超限/存储拒绝。见[截图](screenshots/project-management/README.md)。

仅单浏览器本地草稿槽；无云同步、项目库、草稿文件导入导出、任意库或链接脚本。浏览器清理数据会丢草稿，成功构建包可另行下载。Firefox/WebKit 本批未验证。未重试生产站点；Cloudflare 自动发布由父线程通过 GitHub check 核验。本批保持已批准 CSP `wasm-unsafe-eval` 与 `connect-src 'none'`，无新服务、源码上传或独立部署。
