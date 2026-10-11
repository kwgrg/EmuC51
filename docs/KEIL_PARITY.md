# KEIL C51 / µVision 对照与分批路线图

更新：2026-10-11。对照基线为经典 Intel 8051 / AT89C51 的开发与仿真调试流程，独立实现功能，不复制 KEIL 专有代码、可执行文件或界面资产。此表描述 EmuC51 的实际范围，不承诺与 KEIL 完全兼容。

状态含义：**已实现**表示所列窄范围有实现和自动验证；**部分实现**表示有基础能力但仍缺表中行为；**缺失**表示暂无实现、可进入后续批次；**暂不支持**表示超出当前架构或器件范围，需要独立方案。测试路径均相对仓库根目录。

## 能力差距与验证

| 能力 | 状态 | EmuC51 现状与具体差距 | 验证方式 / 实施前验收要求 |
| --- | --- | --- | --- |
| 本地固件与会话 | 已实现 | BIN、HEX/IHX；本地 JSON 快照、IndexedDB 刷新恢复，含 Watch、断点配置和确认后的内存地址；只有最近一个工作区 | `tests/core/firmware.test.ts`、`tests/persistence/*`、E2E 导入导出/刷新/清除 |
| 工程、源码编辑与 Build/Rebuild [1][6] | 部分实现 | 已有本地单文件 ASM 编辑、真实汇编和行列诊断；没有多文件链接、宏或浏览器 C 编译器 | [ASM 语法/状态规则](ASM_WORKBENCH.md)；单元及 E2E 验证错误定位、取消、重复构建、失败/变更锁定旧产物、刷新与工作区切换 |
| C51 专有编译器集成 | 暂不支持 | 不打包或调用未经授权的 KEIL 工具；无后端构建服务 | 任何工具链变更先检查许可、体积、隐私和可复现构建 |
| Run/Pause/Reset、Step Into/Over [2] | 已实现 | 指令级执行、调用步过、运行上限和可中止 Worker；步过用返回地址及 SP 校验 | `tests/worker/emulator.worker.test.ts`、`tests/core/cpu.test.ts`；嵌套调用、中断、断点、暂停及预算 |
| Step Out 与调用栈 [2][5] | 部分实现 | 已有实时 CALL/中断帧与可中止、有预算的 Step Out；通过帧身份、返回类型/地址/SP 验证，失去可信度就停止。没有符号函数名、源码局部变量或快照中的历史帧 | `tests/core/callstack.test.ts`、Worker、E2E：嵌套、RET/RETI、返回槽同值写入、显式改 SP/PC、回绕/溢出、恢复后未知、预算/取消 |
| 指令反汇编及 PC [3] | 已实现 | 256 编码含保留指令显示，真实操作数、地址、机器码、PC 标识；本批增加独立地址浏览、跟随 PC、浏览历史和按指令翻页 | `tests/core/disassembler.test.ts`、`tests/components/DisassemblyView.test.tsx`、E2E：变长指令、FFFF 回绕、固定地址不改 PC、取消输入 |
| Run to Cursor / 指令行 [2][3] | 已实现 | 原有运行至地址；本批增加指令行“运行至此”，使用同一预算、断点及 Worker 机制 | E2E 行操作、目标为当前 PC 的重复执行、断点优先级由 Worker 测试验证 |
| 地址断点 [4] | 已实现 | 地址增删、继续时一次跳过当前断点、配置保存；本批增加反汇编行切换与状态同步 | `tests/core/debugger.test.ts`、Worker 和 E2E：重复切换、命中、恢复、刷新后保留 |
| 高级断点 [4] | 部分实现 | 已有启用/禁用、只读整数条件和每 N 次真条件命中（1–100,000,000）；尚无命中时命令；单类最多 1024 项 | Debugger/Worker 测试覆盖循环、暂停、步过、idle/中断；持久化测试验证 v1/v2→v3；E2E 验证启停、阈值、复位和导入导出 |
| 访问观察点 [4] | 部分实现 | 新增 DATA/IDATA/XDATA/SFR 显式字节及 BIT 位读写（含同值写入、RMW 顺序和指令 PC）；旧值变化观察点保留。尚无隐式寄存器/栈/CODE 总线访问跟踪 | [范围与语义](CPU_OPERAND_WATCHPOINTS.md)；核心、Worker、持久化和 Chromium E2E |
| Watch 与表达式 [7] | 部分实现 | 支持可添加的只读整数表达式、寄存器/SFR 与显式内存空间；没有类型变量或源码符号解析 | `expressions.test.ts`、Worker/组件及 E2E 覆盖语法、边界、空间隔离、无副作用和导航；详见 [语法说明](WATCH_EXPRESSIONS.md) |
| DATA/IDATA/XDATA/CODE/SFR [8] | 部分实现 | 核心区分直接/间接寻址；IRAM 128B、XRAM/CODE 64KiB、经典 SFR；UI 提供 IRAM/SFR/XRAM/CODE；没有 KEIL 内存类型前缀表达式 | `tests/core/memory.test.ts`、CPU/操作码测试；后续表达式映射不得把 direct SFR 当成 indirect IRAM，不启用 8052 高 128B |
| 内存与寄存器窗口 | 已实现 | 暂停编辑、地址确认/取消/翻页、PSW 选组、最新内存响应过滤 | `tests/components/MemoryNavigation.test.tsx` 与 E2E；CODE 保持只读 |
| C 源码调试、局部变量、类型 [5][9] | 部分实现 | 外部 SDCC 单文件 CDB 精确行定位、多地址行断点与显式地址导航/运行；没有变量/类型或 C 语句步进 | [真实 SDCC 导入与限制](SDCC_SOURCE_DEBUG.md)，摘要绑定、真实多地址样本、刷新/错配/竞态回归 |
| T0/T1、五中断源、P0–P3、UART、PCON [1][10] | 已实现 | classic 8051 机器周期模型；GPIO 引脚与锁存器分离；REN/TI/RI、UART 0–3、RX 第九位、idle/power-down | `tests/core/peripherals.test.ts` 与 E2E UART/GPIO；不宣称电气/晶振/总线波形精度；[UART TI 时点修复及审查范围](CLASSIC_PERIPHERAL_AUDIT.md) |
| UART 终端 [10] | 部分实现 | 数字 RX 注入、TX 捕获、HEX/文本显示和有界历史；没有真实串口连接或可选快速时钟模式 | E2E 回显/第九位及刷新恢复；后续 ASCII 批量输入与定时输入须确定性、可取消 |
| 逻辑分析、覆盖率、性能 [3][11] | 部分实现 | 有周期计数、最近 1000 条跟踪、最多 64 次快照的 GPIO 简图；已有可选指令起始地址执行次数、绑定真实固件摘要的固定报告导出及热点浏览；没有源码/分支覆盖率或带时间轴的信号记录 | 覆盖记录独立于 Trace 缓冲区；Worker/组件/E2E 验证成功指令、故障、IRQ/idle 与清除边界；[说明](INSTRUCTION_COVERAGE.md) |
| 衍生芯片及硬件调试 [1] | 暂不支持 | Timer 2、ADC、SPI、厂商扩展、ULINK/目标板；ARM ITM/SWO/ETM/CoreSight 不属于经典 8051 本轮范围 | 需独立器件配置和明确语义，不能静默扩展 classic 8051 |

## 分批实施顺序

1. **首批：反汇编调试入口（已实现，本地提交 7af4f9c）**。输入地址仅改变浏览位置，Enter/按钮确认、Escape 取消；跟随 PC 与固定位置分离。每页 80 条，后续页按最后一条指令长度推进；返回仅回到真实浏览历史，不从未知边界反向猜指令。行断点沿用现有配置保存，运行至行沿用 Worker；运行中允许浏览，禁止更改断点及重复启动。浏览位置/历史属于临时 UI 状态，离页、刷新或新固件后默认跟随 PC，不改变快照格式。
2. **第二批：断点启停和命中次数（已实现并合入）**。工作区记录升级 v3，CPU 快照保留 v2；旧断点默认启用、阈值 1。仅即将执行的指令算命中，中断响应、idle、显式单步不计；命中后每 N 次重复暂停。暂停/继续保留进度；复位、加载/恢复、编辑 PC 清空计数，更改某断点选项仅清空该地址。启停和阈值可保存，进度不持久化。条件表达式现已实现，详见 [条件断点](CONDITIONAL_BREAKPOINTS.md)。
3. **第三批：Step Out 和可信机器调用帧（已实现并合入）**。捕获真实 CALL/中断进入，保留平衡 PUSH/POP，核验 RET/RETI；返回槽被写入、显式改 SP/PC、返回类型不匹配或栈回绕时丢弃旧帧并标记未知。未知历史之上可追踪新帧并跳出；历史不持久化，不修改 v3 工作区/v2 CPU 快照。通过帧身份而非 PC 地址相等判断完成，预算/暂停和调试停止条件照常生效。
4. **已完成：只读 Watch 表达式子集**。已补齐 Watch / 内存浏览位置的会话持久化和跨流程恢复。条件断点已补齐，采用 v4 配置、真条件计数与错误显式停止。CODE 指令执行覆盖统计已实现并验证成功指令边界，默认关闭。覆盖报告及热点地址导航已补齐，绑定 Worker 实际固件 SHA-256 和统计代次；运行中固定采样，清除/替换排除旧结果。后续不再以覆盖面板小功能作为最高优先级，转向下述开发闭环。地址符号表需要真实格式样本和地址空间定义，不推断 C 局部变量。
5. **独立设计：工程/构建与源码调试**。工具链许可、OMF 或其他开放调试格式、浏览器运行成本确定后，逐步引入工程文件与失败产物隔离。

每批独立分支、针对性回归、全套检查，完成后交付；路线图不是无限期合并或部署授权。

## 核心缺口重新排序（覆盖报告完成后）

覆盖报告批次核对时没有源码工程模型。后续 ASM 批次已补齐单文件编辑/构建/诊断和显式加载；PROJECT_FILES 保留固件视图并增加 ASM 入口；255 个合法操作码已可执行，经典 T0/T1、五中断源、GPIO、UART、PCON 已有实现与测试。因此最影响完整使用流程的是“源码 → 可定位诊断 → 固件 → 调试”，不是继续增加覆盖统计选项。现有测试不能代替芯片时序一致性证明。

| 优先级 / 领域 | 下一批可自主实施的具体内容 | 验收与真实依赖 / 需要的用户选择 |
| --- | --- | --- |
| **P0 工程与构建诊断** | 浏览器本地最小 ASM 工程：源码编辑/本地保存/导入导出、有界两遍汇编、标签和 ORG/DB/EQU、真实行列诊断；成功产物带源码摘要、工具版本、固件摘要；显式加载调试 | 必须完成编辑→错误定位→修正→构建→运行的实际 E2E。覆盖相对跳转范围、AJMP/ACALL 页边界、地址重叠、重复/未定义标签、取消/连续构建/构建中改源码、失败不得误加载旧产物。支持范围公开，不把 ASM 称为 C 编译器；不必先引入服务器或商业工具 |
| **P0 C 工具链路线** | 可先在云端做隔离的 SDCC 原生构建验证，保留源码、版本/选项、诊断与产物用于回归；这只是开发验证，不等于浏览器已有编译能力 | 最初环境无 SDCC/emcc；后续已在 `/tmp` 解包验证 SDCC 4.5.0，emcc 未安装。SDCC 官方列有 MCS51 后端、汇编/链接及源码调试器，但官方支持平台列表不能证明已有可直接使用的浏览器包 [12]。用户现已选择 **SDCC 优先**，浏览器移植仍须验证。服务端编译会改变“不上传源码/固件”的产品承诺，必须另行明确授权，不能默认加入 |
| **P1 真实源码映射** | 自有 ASM 构建可直接生成地址→文件/行映射和 CODE 标签，并绑定源码/固件摘要；先支持行断点、PC 高亮，错误摘要拒绝关联 | C 调试需要选定工具链的真实产物和样本；Keil 调试信息在绝对 OMF 模块中，不在普通 HEX 内 [9]。不能从 BIN 猜局部变量，也不能默认采用 ARM ELF/DWARF。类型、优化后的多地址行、overlay/寄存器变量需要单独设计 |
| **P1 经典 8051 外设验证** | 增加可重复、可取消的按机器周期 GPIO/UART 输入序列，配套定时器溢出、中断嵌套、UART 回显的可构建演示；把当前手工注入变成可复现回归 | 不需要新增器件类型；需定义同周期事件顺序和复位/快照行为。边界语义按已有经典 8051 基线。Timer2、ADC、SPI、具体衍生芯片或电气波形需用户明确目标型号，不纳入本批 |
| **P1 调试器访问语义** | 补 CPU 读/写访问观察点：指定空间/范围、区分读取/写入/同值写入、明确执行前后停止；UI/Watch 读取不触发 | 可独立实施，但须给存储器访问加来源标记并测试外设/快照行为，防止把现有“值变化观察点”悄悄改语义。源码变量观察要等真实元数据。此项排在构建闭环之后 |

**P0 本地单文件 ASM 闭环已完成**：保留固件调试入口，新增项目数据与独立构建 Worker。源码修改、取消或失败撤下可加载产物；CPU 内已有固件保留，但绑定过期时锁定执行。多文件链接和宏体系仍未实现。用户已选择 SDCC，下一批按 [SDCC 集成路线](SDCC_INTEGRATION.md)推进真实工具链和源码关联，不自行编写 C 编译器。

上表保留拆分依据；**单文件 ASM 子集已实现，浏览器 C 编译器尚未实现，外部 SDCC 精确源码行定位/断点已完成**。用户已选择 SDCC；已用可信 Debian 包在云端验证真实 4.5.0 编译、classic 8051 的 `--iram-size 128` 及生成固件的运行，详见 [SDCC 集成路线](SDCC_INTEGRATION.md)。本批已完成真实 SDCC 产物/源码/CDB 导入关联与源码定位，并完成有限的浏览器移植来源/进程/许可核验，不因原生编译成功宣称浏览器 C 编译。依赖判断来自仓库与当前云环境检查；[SDCC 官方说明](https://sdcc.sourceforge.net/)和 [Keil OMF 说明](https://www.keil.com/support/docs/181.htm)于 2026-10-11 核验。SDCC 各组件采用不同开源许可，浏览器分发前须记录所选组件、版本及其实际许可义务，不能从“开源”直接推断任意打包方式可用。

## 官方参考

仅参考公开文档中的功能行为，不下载或复制 KEIL 软件/资产。µVision 文档覆盖多种架构，采用时须过滤器件专有功能。

1. [Keil C51 产品范围](https://www.keil.com/products/c51/)
2. [µVision Debug 菜单与执行控制](https://www.keil.com/support/man/docs/uv4cl/uv4cl_ui_debug.htm)
3. [Disassembly Window](https://www.keil.com/support/man/docs/uv4cl/uv4cl_db_dbg_disasmwin.htm)
4. [Breakpoints Window](https://www.keil.com/support/man/docs/uv4cl/uv4cl_db_dbg_breakpnts.htm)
5. [Call Stack and Locals](https://www.keil.com/support/man/docs/uv4cl/uv4cl_db_dbg_callstack.htm)
6. [Build a Project](https://www.keil.com/support/man/docs/uv4cl/uv4cl_ca_buildproject.htm)
7. [Watch Window](https://www.keil.com/support/man/docs/uv4cl/uv4cl_db_dbg_watchwin.htm)
8. [Memory Type Specifiers](https://www.keil.com/support/man/docs/uv4cl/uv4cl_memtypespec.htm)
9. [LOAD 调试模块](https://www.keil.com/support/man/docs/uv4cl/uv4cl_cm_load.htm) 与 [C51 调试信息说明](https://www.keil.com/support/docs/181.htm)
10. [AT89C51 器件范围](https://www.keil.com/DD/nDetails.asp?DID=2976&O=SM&VN=Atmel+89C51) 与 [UART Communication](https://www.keil.com/support/man/docs/uv4cl/uv4cl_sm_uartcommunication.htm)
11. [C51 Coverage 命令](https://www.keil.com/support/man/docs/uv4cl/uv4cl_cm_coverage.htm)

12. [SDCC 官方项目、组件和支持平台](https://sdcc.sourceforge.net/)
