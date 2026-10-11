# C51 Geek Terminal Design System

> Source of truth: Google Stitch project **C51 Geek Terminal** (`projects/9059343258789011941`), design system **Cyber-C51 Emulator System**. Synced on 2026-08-01. Never store Stitch credentials or signed asset URLs in this repository.

## 1. Design direction

The interface is a retro-futuristic 8051 diagnostic terminal for engineers and learners. It combines the rigid structure of a command-line workbench with restrained glass layers and CRT-like luminous accents.

- Mood: deep focus, technical precision, local-machine confidence.
- Geometry: square corners everywhere except circular LEDs and rotary indicators.
- Surfaces: layered transparent black panels; use borders, not soft card shadows, to establish hierarchy.
- Motion: glow only for execution, selection, and live signals. Respect `prefers-reduced-motion`.
- Motifs: 40 px circuit grid, subtle 4 px scanlines, compact status bits, monospaced data alignment.
- Product truth wins over concept copy. The classic 8051 core now includes digital peripherals and instruction-boundary debugging; do not claim WebAssembly, precise bus timing, cloud sync, full A51/SDAS compatibility, browser C compilation, or source-level debugging. The local single-file ASM subset is documented separately.

## 2. Tokens

### Color

| Token | Value | Use |
| --- | --- | --- |
| `terminal-bg` | `#0a0a0a` | App canvas and inset data surfaces |
| `surface` | `#131313` | Default dark surface |
| `surface-lowest` | `#0e0e0e` | Footer, inset terminal areas |
| `surface-low` | `#1c1b1b` | Secondary surface |
| `surface-container` | `#201f1f` | Neutral controls |
| `surface-high` | `#2a2a2a` | Hover/raised neutral |
| `surface-highest` | `#353534` | Strong neutral separator |
| `glass-surface` | `rgba(20, 20, 20, 0.78)` | Terminal windows with `backdrop-filter: blur(12px)` |
| `on-surface` | `#e5e2e1` | Primary text |
| `on-surface-variant` | `#baccb0` | Secondary text |
| `outline` | `#85967c` | Labels and subdued metadata |
| `outline-variant` | `#3c4b35` | Inactive 1 px borders |
| `primary` | `#39ff14` | Run/success/current instruction/live output |
| `primary-dim` | `#2ae500` | Primary hover and glow |
| `primary-soft` | `#79ff5b` | Readable primary data text |
| `secondary` | `#00f1fd` | Addresses, navigation, information |
| `secondary-soft` | `#6ff6ff` | Readable secondary data text |
| `warning` | `#f59e0b` | Limitations and byte highlights |
| `error` | `#ffb4ab` | Human-readable error text |
| `error-red` | `#ef4444` | Hardware-style fault/display accent |
| `circuit-trace` | `#162221` | Background grid at low opacity |

Do not introduce arbitrary accent colors. New semantic states must reuse these roles or be added here first with contrast verification.

### Typography

- Primary/code/headlines: `JetBrains Mono`, then `Cascadia Mono`, `SFMono-Regular`, `Consolas`, monospace.
- Labels/metadata: `Fira Sans`, then `Segoe UI`, sans-serif.
- `headline-lg`: 32/40 px, weight 700, tracking `-0.02em`.
- `headline-md`: 24/32 px, weight 600.
- `code-display`: 18/28 px, weight 500, tracking `0.05em`.
- `body-sm`: 14/20 px, weight 400.
- `label-caps`: 12/16 px, weight 700, tracking `0.1em`, uppercase.
- `address-label`: 11/14 px, weight 400.

The application must remain usable when the named fonts are not installed; external fonts are intentionally not fetched because production CSP is self-only.

### Spacing and layout

- Base unit: 4 px.
- Gutter: 16 px.
- Desktop page margin: 24 px; mobile page margin: 12 px.
- Terminal window body padding: 12 px unless dense data requires 8 px.
- Desktop: 12-column workbench logic; terminal panes align to a strict grid.
- Mobile: one-column content and a persistent bottom navigation. Never compress dense tables until values become ambiguous; allow horizontal scrolling inside the pane.

## 3. Components and states

### Terminal window

- 1 px inactive border using secondary/outline at low opacity.
- 26 px header bar: uppercase title on the left, rectangular status bits on the right.
- Active/live pane: primary border plus a restrained `0 0 8px` primary glow.
- Body uses transparent black so the circuit grid can show through faintly.

### Commands

- Primary: black background, 1 px neon-green border/text; hover fills green and switches text to black.
- Secondary: same behavior with cyber blue.
- Ghost: no fill; prefix command copy with `>` where it reads naturally.
- Disabled controls retain their geometry and use reduced opacity.
- All keyboard-focusable controls require a visible 1 px primary outline.

### Data, lists, and status

- Addresses are cyber blue; executable/current values are neon green; raw bytes may use amber.
- Separate list rows with low-opacity 1 px lines. Zebra striping is forbidden.
- The current instruction is a full-row primary fill with black text.
- Status bits are small square labels. Active bits use primary fill; inactive bits use transparent fill and a muted border.
- LEDs are the only routinely circular component; active LEDs glow in their semantic color.

### Inputs

- Dark inset or transparent background, square corners, bottom border only for data entry.
- Hex/address inputs use monospaced text and an explicit accessible label.
- File input remains local-only and accepts `.bin` up to 64 KiB or `.hex`/`.ihx` text up to 1 MiB decoding to at most 64 KiB CODE.

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
