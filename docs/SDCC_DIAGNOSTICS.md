# SDCC 构建诊断到源码编辑

2026-10-13。本批独立实现参考 µVision 官方 [Build the Project](https://www.keil.com/support/man/docs/uv4cl/uv4cl_ca_buildproject.htm) 描述的“构建输出→源码→修改→构建”流程。Keil 支持 Build/Rebuild 与依赖增量构建；本应用仍在全新 Worker/虚拟文件系统中全量编译，不声称实现 C51 编译器、完整 µVision 或源码语句步进。

## 操作

1. 在 C/SDAS 面板编辑单 C 或已加载混合工程的文件，点击「编译 C 工程」。
2. 「构建诊断」列出受支持的位置错误/警告/注释。点击可定位项会切换对应文件、聚焦编辑器并选择位置；没有列号则选择整行，不补造列号。
3. 「原始构建日志」按真实 sdcpp、sdcc、sdas8051、sdld 阶段保留 stderr 和诊断 stdout。预处理器 stdout 是完整预处理源码，不作为日志复制。后续阶段失败仍保留前面阶段的警告；链接错误若没有可信源位置只显示日志。
4. 修复、编译、显式加载后沿用既有调试流程。源码编辑、新编译、取消、工作区切换或卸载都会使旧诊断与旧产物失效。
5. 切换文件不会丢弃其他文件编辑；用示例或「编辑已加载 C 工程」替换有编辑的草稿时，浏览器原生确认允许保留草稿。此确认不新增云保存能力，离开面板的临时草稿生命周期仍与此前相同。

## 可信映射边界

- 只识别固定工具链已验证的位置格式；保留每条原文。SDCC syntax error 的 `; column N` 只有实际提供时才解析。SDAS 本批真实错误仅提供文件与行。
- `/work/` 是固定编译虚拟根，`./` 是其当前目录；这两种显式路径必须精确对应工程路径。相对完整路径大小写精确匹配；仅 basename 时必须在当前清单中唯一。未知绝对路径、路径穿越、错误大小写、同名歧义和越界行禁止导航。
- 每段日志携带构建阶段及用户/生成汇编来源。生成汇编错误不冒充用户 C 行，链接器输出不猜源码位置。
- C/SDAS 编辑器保留物理行（长行在编辑器内部横向滚动），跳转滚动到目标行及可精确映射的列，避免窄屏软折行使目标移出视野。编辑器 DOM 将换行规范化为 LF，选区按该值计算。仅 ASCII 无制表符且列号在有效范围时定位精确列；非 ASCII、制表符或越界列保留编译器报告列号，但选择整行，不猜字符宽度。
- 定位只改变文件选择、焦点及选区，不写源码、不更改 CPU/PC。诊断绑定输入对象、工作区代次与请求身份，不能通过旧回调污染新工程。
- 可导航列表最多 200 项；超出仍保留原始日志。原始诊断日志合计上限 1 Mi 字符，原有每阶段输出、源码、产物上限继续生效。

## 实测与复核

真实 Chromium Worker（生产 CSP）验证了：

- `main.c:2: syntax error: token -> ';' ; column 20`：选区定位到第 2 行的报告列；成功构建 warning 也可导航。
- `include/shared.h:10:2: error: #error HEADER_DIAGNOSTIC`：从 main 切换到头文件；不是把 include 堆栈行当错误。
- `asm/bridge.asm:27: Error: <q> missing or improper operators, terminators, or delimiters`：从 main 切换到手写 ASM，选中 ` mov a,#` 整行。此前 C 警告仍保留。修复后真实编译/加载/运行，word_result=4864。
- 未定义链接符号失败不产生跳转；编辑、取消、固件切换清除旧诊断。确认取消不丢草稿或其当前诊断。

正式用例：`tests/core/sdcc-diagnostics.test.ts`、`tests/core/sdcc-build.test.ts`、`tests/components/useCBuild.test.tsx`、`tests/e2e/c-diagnostics.spec.ts`。截图/网络录制：`node scripts/capture-diagnostics.mjs`；线上仅在自动部署后设置 `EMUC51_ACCEPTANCE_URL` 和独立 `EMUC51_EVIDENCE_DIR` 运行，逐个响应比对本地 dist SHA-256。代码没有改生产 CSP，没有源码上传接口。

[截图与实测记录](screenshots/sdcc-diagnostics/README.md)。Firefox/WebKit、真实手机、任意 SDCC 输出格式和复杂工程仍未覆盖。
