# KEIL C51 / µVision 对照与分批路线图

更新：2026-10-11。对照基线为经典 Intel 8051 / AT89C51 的开发与仿真调试流程，独立实现功能，不复制 KEIL 专有代码、可执行文件或界面资产。此表描述 EmuC51 的实际范围，不承诺与 KEIL 完全兼容。

状态含义：**已实现**表示所列窄范围有实现和自动验证；**部分实现**表示有基础能力但仍缺表中行为；**缺失**表示暂无实现、可进入后续批次；**暂不支持**表示超出当前架构或器件范围，需要独立方案。测试路径均相对仓库根目录。

## 能力差距与验证

| 能力 | 状态 | EmuC51 现状与具体差距 | 验证方式 / 实施前验收要求 |
| --- | --- | --- | --- |
| 本地固件与会话 | 已实现 | BIN、HEX/IHX；本地 JSON 快照、IndexedDB 刷新恢复；只有最近一个工作区 | `tests/core/firmware.test.ts`、`tests/persistence/*`、E2E 导入导出/刷新/清除 |
| 工程、源码编辑与 Build/Rebuild [1][6] | 缺失 | 当前加载已生成的固件；没有文件树编辑、编译器、链接器或构建诊断 | 后续选择可合法分发且可浏览器本地运行的工具链；验证全量/增量构建、错误定位、取消，以及构建失败不误调试旧产物 |
| C51 专有编译器集成 | 暂不支持 | 不打包或调用未经授权的 KEIL 工具；无后端构建服务 | 任何工具链变更先检查许可、体积、隐私和可复现构建 |
| Run/Pause/Reset、Step Into/Over [2] | 已实现 | 指令级执行、调用步过、运行上限和可中止 Worker；步过用返回地址及 SP 校验 | `tests/worker/emulator.worker.test.ts`、`tests/core/cpu.test.ts`；嵌套调用、中断、断点、暂停及预算 |
| Step Out 与调用栈 [2][5] | 缺失 | 没有执行调用帧记录及退出当前帧命令；不得把 IRAM 栈任意两字节猜成调用栈 | 后续记录调用/返回与中断帧，验证嵌套、RET/RETI、手动改 SP、复位/恢复、预算/取消 |
| 指令反汇编及 PC [3] | 已实现 | 256 编码含保留指令显示，真实操作数、地址、机器码、PC 标识；本批增加独立地址浏览、跟随 PC、浏览历史和按指令翻页 | `tests/core/disassembler.test.ts`、`tests/components/DisassemblyView.test.tsx`、E2E：变长指令、FFFF 回绕、固定地址不改 PC、取消输入 |
| Run to Cursor / 指令行 [2][3] | 已实现 | 原有运行至地址；本批增加指令行“运行至此”，使用同一预算、断点及 Worker 机制 | E2E 行操作、目标为当前 PC 的重复执行、断点优先级由 Worker 测试验证 |
| 地址断点 [4] | 已实现 | 地址增删、继续时一次跳过当前断点、配置保存；本批增加反汇编行切换与状态同步 | `tests/core/debugger.test.ts`、Worker 和 E2E：重复切换、命中、恢复、刷新后保留 |
| 高级断点 [4] | 部分实现 | 尚无启用/禁用、条件表达式、命中次数、命中时命令；单类最多 1024 项 | 下一批可先做启停及命中次数；验证运行时行为和快照兼容，再引入受限表达式 |
| 访问观察点 [4] | 部分实现 | 当前只比较每个执行单元前后的单字节存储值变化，包含外设更新；不是 CPU 读/写访问跟踪，写入相同值不触发，UI 读取不触发 | `tests/core/debugger.test.ts` 和外设/Worker 测试；扩展前须区分 CPU 访问、外设更新和 UI 读取，并覆盖相同值写入 |
| Watch 与表达式 [7] | 部分实现 | 有寄存器、固定 PC/SP/DPTR/ACC 面板和字节内存；没有可添加表达式、类型变量或符号解析 | 后续先支持只读寄存器/SFR/常量/显式内存空间，不使用 JS eval；验证非法表达式、空间隔离与无副作用 |
| DATA/IDATA/XDATA/CODE/SFR [8] | 部分实现 | 核心区分直接/间接寻址；IRAM 128B、XRAM/CODE 64KiB、经典 SFR；UI 提供 IRAM/SFR/XRAM/CODE；没有 KEIL 内存类型前缀表达式 | `tests/core/memory.test.ts`、CPU/操作码测试；后续表达式映射不得把 direct SFR 当成 indirect IRAM，不启用 8052 高 128B |
| 内存与寄存器窗口 | 已实现 | 暂停编辑、地址确认/取消/翻页、PSW 选组、最新内存响应过滤 | `tests/components/MemoryNavigation.test.tsx` 与 E2E；CODE 保持只读 |
| C 源码调试、局部变量、类型 [5][9] | 缺失 | BIN/HEX 不含源码映射；不伪造源码行单步或符号 | 须导入真实调试元数据；C51 绝对 OMF 与 ARM ELF/DWARF 不能默认等价；先选定格式并验证来源、范围和匹配的固件摘要 |
| T0/T1、五中断源、P0–P3、UART、PCON [1][10] | 已实现 | classic 8051 机器周期模型；GPIO 引脚与锁存器分离；REN/TI/RI、UART 0–3、RX 第九位、idle/power-down | `tests/core/peripherals.test.ts` 与 E2E UART/GPIO；不宣称电气/晶振/总线波形精度 |
| UART 终端 [10] | 部分实现 | 数字 RX 注入、TX 捕获、HEX/文本显示和有界历史；没有真实串口连接或可选快速时钟模式 | E2E 回显/第九位及刷新恢复；后续 ASCII 批量输入与定时输入须确定性、可取消 |
| 逻辑分析、覆盖率、性能 [3][11] | 部分实现 | 有周期计数、最近 1000 条跟踪、最多 64 次快照的 GPIO 简图；没有逐指令覆盖率、分支统计或带时间轴的信号记录 | 后续将覆盖率与有限跟踪缓冲区分开；验证循环计数、复位和中断，不把快照示意当作精确采样 |
| 衍生芯片及硬件调试 [1] | 暂不支持 | Timer 2、ADC、SPI、厂商扩展、ULINK/目标板；ARM ITM/SWO/ETM/CoreSight 不属于经典 8051 本轮范围 | 需独立器件配置和明确语义，不能静默扩展 classic 8051 |

## 分批实施顺序

1. **本批：反汇编调试入口（已实现，独立分支待交付）**。输入地址仅改变浏览位置，Enter/按钮确认、Escape 取消；跟随 PC 与固定位置分离。每页 80 条，后续页按最后一条指令长度推进；返回仅回到真实浏览历史，不从未知边界反向猜指令。行断点沿用现有配置保存，运行至行沿用 Worker；运行中允许浏览，禁止更改断点及重复启动。浏览位置/历史属于临时 UI 状态，离页、刷新或新固件后默认跟随 PC，不改变快照格式。
2. **下一候选：断点启停和命中次数**。先补配置迁移、恢复后的命中计数定义、原有一次跳过语义，再逐步增加条件表达式。属于候选计划，尚未实现。
3. **下一候选：Step Out 和可验证调用栈**。先在执行核心记录帧与可信度，再做 UI；禁止只看当前 SP 推断完整历史。
4. **下一候选：只读 Watch 表达式**。共享显式地址空间规则，覆盖 SFR 读取副作用；再评估符号元数据导入。
5. **独立设计：工程/构建与源码调试**。工具链许可、OMF 或其他开放调试格式、浏览器运行成本确定后，逐步引入工程文件与失败产物隔离。

每批独立分支、针对性回归、全套检查，完成后交付；路线图不是无限期合并或部署授权。

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
