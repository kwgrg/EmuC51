# EmuC51 Neutral Workbench Design System

Updated 2026-10-12 following the user's request to reference the ChatGPT web visual language. This supersedes the original C51 Geek Terminal / Stitch visual direction; technical interaction contracts below remain applicable.

## 1. Design direction

A focused engineering workspace with neutral charcoal surfaces, a quiet sidebar, soft separators and restrained rounded corners. EmuC51 remains an 8051 compiler/debugger, not a chat application. No third-party brand assets, fonts, icons, analytics or remote runtime requests are introduced.

The existing application has a fixed dark theme and no user theme switch. Preserve that mechanism. Remove scanline/grid backgrounds and ornamental neon glow. Use color for execution, addresses, errors and breakpoints, with text or shape conveying the same state.

## 2. Tokens and typography

- Canvas `#212121`; sidebar/inset `#171717`; panels `#242424`; controls `#303030`; hover `#383838`.
- Text `#ececec`; secondary `#b8b8b8`; metadata `#a3a3a3`; separators `#3b3b3b`.
- Execution/success `#8bd5b0`; address/information `#b4c9e4`; warning/breakpoint `#e9bd75`; error `#ffb4ab`.
- System sans-serif for navigation, headings and explanations. Locally available monospace for source, memory, registers and logs; tabular numerals for aligned data. No font downloads.
- Ordinary technical labels are 11–13px; small badges are 10px. Source stays 13px/20px. Main headings use 36–60px only on the welcome view.
- Borders 1px; controls 6–8px radius; panels 10px; welcome cards 12px. Avoid glow except illustrative hardware signals.
- Desktop header 60px, footer 30px; pane gutters 12px and outer spacing 16px. Mobile header 56px and bottom navigation 54px.

## 3. Components and accessibility

- Desktop sidebar can collapse with a labeled button using `aria-expanded` and `aria-controls`. Collapse changes presentation only and leaves drafts, CPU and build identity intact. Header navigation remains available. Narrow layouts retain bottom navigation and in-panel import actions.
- Active navigation uses a neutral filled surface plus `aria-current`. Running/paused state has explicit text in the header. Execution controls retain semantic green, breakpoints their visible filled/hollow markers, and current instruction a contrasting full-row highlight.
- Buttons and file-picker labels have visible keyboard focus. Keep native controls and keyboard behavior; don't invent a modal or replace browser file dialogs for appearance.
- Dense tables scroll inside their panel; don't wrap hexadecimal byte columns or shrink data to fit a phone. Logs and long identifiers wrap or scroll within bounded areas. Controls wrap without disappearing.
- Default, hover, focus, disabled, running, stale-build and error states must remain distinct. Reduced-motion behavior remains respected.
- Validate actual pages at 1440, 1280, 820 and 390px widths. Screenshots and review notes live in `docs/screenshots/neutral-workbench/`.

## 4. Page patterns

### HOME

Use a status chip, truthful product proposition, `INIT_ENV` and local firmware actions, a CSS-rendered 8051 chip motif, and a feature/metrics grid. The page explains the product; it does not expose dense debugger controls.

### BIN_INSPECTOR

Use the workbench composition: firmware pane, disassembled instructions and trace inspector, runtime controls, debugger controls, CPU monitor, output console, port LEDs, and execution settings. Display actual operands and jump targets, highlight the current PC, and provide address breakpoints, memory change watchpoints, step over, and run to address. Register editing is available while stopped. Show a CALL_STACK pane with recorded CALL/ISR addresses, return addresses and stack positions. Label incomplete/unknown history explicitly; enable Step Out only when a verified current frame exists. Returning from a snapshot must not display invented callers. Support an independent CODE address draft (Enter/apply, Escape/cancel), pinned browsing, return-to-PC following, decoded instruction paging, and bounded navigation history. Instruction rows provide accessible breakpoint toggles and run-to actions, disabled while executing. Breakpoint rows provide an enable checkbox and a decimal hit threshold with explicit apply and Escape cancellation. Disabled breakpoints remain visible as hollow markers in disassembly and remain removable; their threshold survives re-enabling. Show the transient count reset rules next to the controls. Browse actions never edit PC; leaving the view returns to PC following. Never imply editable assembly source.

### SYS_MEM

Give the memory dump the largest area. Keep CODE/IRAM/SFR/XRAM tabs, address navigation, byte editing while stopped, IRAM preview, watch values, and the register bank visible in adjacent terminal panes. CODE remains read-only. Address drafts apply on Enter/REFRESH and cancel on Escape or leaving the view; invalid or out-of-range hex input disables submission. Page controls move by 256 bytes and disable at memory boundaries. Register bank status follows PSW.RS1/RS0.

### I/O_PORTS

Present digital GPIO input and output: label external input, output latch, and observed pins separately. Provide accessible port bit controls, a UART console with local input and output, timer and interrupt status, and the PCON state. Inputs remain available while executing. Port-derived display and stepper previews are illustrative signals; never imply electrical or mechanical simulation.

### Workspace transfer

Provide local workspace download and a labeled JSON file input. Validate imported files before replacing the current workspace, show readable errors, and retain the active firmware on failure. Keep loading, restoring, and paused states explicit; imports and exports never use network requests.

## 5. Adding a page

1. Add one entry to the shared navigation model and provide desktop plus mobile labels.
2. Build the view from terminal windows and existing tokens; do not fork a new visual language.
3. Define empty, loading/restoring, active, disabled, and fault states before adding decorative detail.
4. Keep emulator claims aligned with `README.md` and the implemented core.
5. Verify at 1280×1024, 820 px, and 390 px widths; dense panes must scroll internally without causing page-level horizontal overflow.
6. Add an end-to-end navigation assertion and preserve the local-only request invariant.
7. Update this document when a new token, component contract, or page pattern is introduced.

## 6. Accessibility and privacy invariants

- Maintain WCAG-readable contrast; primary/secondary glow never substitutes for text or borders.
- Every icon-only signal needs a text alternative or title; color is not the sole carrier of run/fault state.
- Use semantic landmarks and labeled navigation. Keep focus order consistent with visual order.
- Production remains self-contained under the existing CSP: no analytics, remote fonts, remote images, or runtime API calls.
- Firmware names, bytes, hashes, CPU state, memory, and traces stay in the browser and are never included in outbound requests.

## Watch panel

The SYS_MEM Watch panel accepts read-only expressions saved with the workspace. Each row shows its expression and either a decimal/hex value or a local error. Show sampling PC and instruction count; discard superseded replies when the list or firmware changes. Enter adds a trimmed expression, Escape cancels the draft, duplicate entries and lists over 32 rows are blocked. Narrow layouts wrap expressions without page overflow. See [expression semantics](docs/WATCH_EXPRESSIONS.md).

Debug sessions persist accepted Watch rows and confirmed memory positions only. Drafts and disassembly history remain temporary. Successful workspace imports replace settings and reset disassembly browsing even when the imported firmware matches the current image.

Conditional breakpoint rows provide a bounded condition draft alongside the hit threshold. Enter applies both fields, Escape cancels the current draft, and disabled breakpoints retain their condition. Runtime condition errors stop execution and show the address, expression and diagnostic in the alert area; they never render as a successful ordinary breakpoint or silently resume.

Instruction coverage is opt-in and session-only. The summary reports successful instruction count and unique instruction-start addresses, never a source/byte/branch coverage percentage. Disassembly shows sampled counts only while recording or when retained data exists. Keep polling bounded to the visible rows; loading a new firmware removes old labels immediately.


覆盖热点面板显示固定采样的代次、执行单元、PC 和真实固件摘要，与实时计数区分。采样/导出运行中可用；待处理时禁用重复请求，清除仍可用。热点按次数降序展示最多 20 项，长摘要可换行；地址按钮只改变反汇编浏览并聚焦地址输入，保留历史及跟随 PC 入口。清除/复位/切换模式/换固件撤下旧报告。


ASM 工作台作为 BIN_INSPECTOR 下方独立面板，保留原二进制调试入口。必须展示当前草稿、构建状态及来源关联；源码过期时在执行控制附近显示锁定原因。诊断按钮定位文本选区，移动端工具栏换行，源码区内部滚动。运行中源码只读，构建中可编辑取消；不使用伪源码单步标识。

### 外部 SDCC 源码关联

工作区 v4 的可选 `settings.sdccDebug` 保存清单和原始源码/IHX/CDB；与 ASM 固件绑定互斥。显式导入先验证全部文件摘要、CDB 子集及实际 CODE 摘要，再替换状态。本地恢复通过 `useSdccDebug` 异步复验，按数据/固件身份屏蔽过期结果；源码面板只消费验证结果。行断点展开为已有地址断点，不增加 Worker/CPU 协议或源码步进语义。JSON 上限 8 MiB；可信本地构建与摘要的边界见 [说明](docs/SDCC_SOURCE_DEBUG.md)。

## CPU 字节操作数访问观察点（2026-10-11）

独立 OperandMemory 适配器仅用于 CPU 显式字节操作数，避免全局 Memory 钩子混入 UI、表达式、验证或外设访问。按需捕获有序事件，Worker 在指令后匹配可选 `accessWatchpoints`；旧值变化观察点保持原行为。工作区 v4 可选字段，CPU v2 不变；配置最多 128 项。实现边界和验证见 [功能说明](docs/CPU_OPERAND_WATCHPOINTS.md)。

位访问扩展：共享核心位地址解析，BIT 观察点独立于字节观察点；显式位读写携带映射位置和读来源，CPL/JBC 保留锁存器读改写顺序。UI/隐式 flags/底层保留其他位的读不生成显式访问。工作区 v4 和 CPU v2 保持不变，新增核心、Worker、浏览器回归；最终执行完整聚合检查。

经典 UART TI 正确性：模式 1/2/3 在停止位开始置 TI，完整输出仍等待停止位结束；可选帧标记 tiRaised 保留软件确认状态，避免恢复或结束时重复中断。CPU v2/工作区 v4 保持兼容，独立 ASM 程序验证 T0/T1、idle、ISR 和 RETI。详见 [外设核对](docs/CLASSIC_PERIPHERAL_AUDIT.md)。

ASM 真实行映射：汇编器第二遍成功编码生成 line/column/address/length/kind，Worker 与摘要一起传递，失败不返回部分映射。仅匹配已加载 ASM 绑定时启用；指令起点可行断点/导航/运行，数据/空隙不猜测。列表每页 100 行，刷新后匹配重建，不增加持久化字段。当前未完成核心项及依赖统一见 [最新路线图](docs/KEIL_PARITY.md)。

2026-10-11：补齐有界 GPIO/UART 输入场景重放，绑定固件、按执行边界投递并记录实际周期；定义可持久化，恢复默认不启用调度。详见 [输入场景](docs/INPUT_SCENARIOS.md)。下一批聚焦可信静态符号，未引入通用脚本、多文件工程或新工具链。

2026-10-11：已增加绑定成功构建的 ASM CODE 标签及真实 SDCC CDB 静态全局存储字节观察。完整身份区分同名，类型/位置未经验证时不给读值；派生表与采样不持久化，恢复后核验原始产物。详见 [可信符号](docs/VERIFIED_SYMBOLS.md)。
