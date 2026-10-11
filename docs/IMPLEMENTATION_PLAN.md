# EmuC51 Web/Cloudflare 实施基线

- 架构版本：Web v2（经典 8051 外设与调试）
- 更新日期：2026-10-11
- 运行位置：用户浏览器
- 托管方式：Cloudflare Workers Static Assets
- 生产地址：<https://emuc51.kwgrg-01.workers.dev>
- 服务端数据存储：无

本文档是 EmuC51 后续开发和验收的基准。本项目已经从 Rust 本地 CLI 路线切换为 TypeScript 浏览器单页应用；Git 历史保留原 Rust 骨架。

## 1. 产品目标与边界

用户打开网页后即可选择本地 8051 BIN 或 Intel HEX 固件，完成单步、连续运行、暂停、复位、反汇编、调试和外设交互，无需安装或登录。

当前包含：

- 最大 64 KiB CODE 的 BIN/HEX/IHX 固件；
- 经典 8051 CPU、存储器、SFR、位寻址和 255 个有效操作码编码；
- Web Worker 后台执行；
- 浏览器工作台和最近 1,000 条内存态指令跟踪；
- 最近一个完整工作区的 IndexedDB 自动保存和恢复；
- 地址断点、内存变化观察点、步过、运行至地址和暂停时修改状态；
- T0/T1、五个中断源、数字端口输入、UART 和 PCON；
- 本地工作区 JSON v3 导入导出及 v1/v2 记录升级；
- 无后端 Cloudflare 静态部署。

范围之外：

- 8052 和厂商扩展；
- GPIO 电气行为、精确总线/晶振波形和器件物理模型；
- 汇编器、源码级调试和反汇编编辑；
- 用户账号、多项目、跨设备同步、分享链接、PWA 和离线首次打开。

## 2. 系统架构

```text
本地 .bin/.hex/.ihx 文件
  → 浏览器 File API 读取、HEX 解析和 64 KiB CODE 校验
  → SHA-256 标识
  → 固件副本传入 Dedicated Web Worker
  → Cpu8051 在 Worker 内取指、译码和执行
  → 状态/跟踪/内存切片返回 React 主线程
  → 一致性快照写入 IndexedDB
  → 刷新后恢复固件与 CPU 状态

Vite build → dist → Cloudflare Workers Static Assets
```

### 2.1 技术栈

- TypeScript、React、Vite；
- Dedicated Web Worker；
- IndexedDB，使用 `idb` 封装；
- Vitest、Testing Library、fake-indexeddb、Playwright；
- Wrangler，仅部署静态资源。

代码使用 `Uint8Array` 表示所有字节空间，通过 `u8`、`u16` 和 `sign8` 统一截断 JavaScript 数值。

### 2.2 核心 API

```ts
class Cpu8051 {
  constructor(program: Uint8Array);
  reset(): void;
  step(): StepResult;
  runChunk(maxSteps: number, timeBudgetMs: number, trace?: boolean): RunChunkResult;
  state(): CpuViewState;
  snapshot(): CpuSnapshot;
  restore(snapshot: CpuSnapshot): void;
  readMemory(space: MemorySpace, address: number, length: number): Uint8Array;
  writeMemory(space: MemorySpace, address: number, value: number): void;
  setRegister(name: string, value: number): void;
  setPortInput(port: number, value: number): void;
  receiveSerial(value: number, ninthBit?: boolean): void;
}
```

Worker 使用带 `requestId` 的可判别联合协议，支持：

- `LoadFirmware`、`RestoreWorkspace`；
- `Reset`、`Step`、`Run`、`Pause`；
- `SetDebugConfig`、`RunToAddress`、`StepOver`、`StepOut`；
- `WriteMemory`、`SetRegister`、`SetPortInput`、`ReceiveSerial`；
- `ReadMemory`、`CreateSnapshot`；
- `Ready`、`StateChanged`、`TraceBatch`、`MemoryData`；
- `SnapshotCreated`、`Stopped`、`ExecutionFault`、`CommandRejected`；
- `DebugConfigChanged`、`SerialOutput`。

连续运行每批最多 10,000 条指令或 16 ms，随后让出 Worker 事件循环。UI 状态更新限频，运行期间每 2 秒生成一次持久化快照。

## 3. 隐私与持久化

### 3.1 服务边界

- Wrangler 没有 `main`，不存在服务端 Worker 代码；
- 不配置 API、KV、D1、R2、Durable Objects 或其他绑定；
- 不使用 Cookie、远程字体、第三方 CDN、广告或客户端遥测；
- 固件读取后只进入 IndexedDB 和 Web Worker，不执行网络上传；
- 生产 CSP 的 `connect-src 'none'` 禁止应用主动联网；
- Cloudflare 普通静态资源访问日志不包含用户固件或模拟器状态。

### 3.2 IndexedDB 数据

数据库名为 `emuc51`，IndexedDB 结构版本仍为 1，只保存键 `current`；记录格式版本为 3，CPU 状态仍为 2（旧记录 1/2 可升级）：

```ts
interface WorkspaceRecord {
  schemaVersion: 3;
  coreStateVersion: 2;
  firmware: {
    name: string;
    bytes: ArrayBuffer;
    sha256: string;
    loadedAt: number;
  };
  cpu: CpuSnapshot;
  settings: {
    maxSteps: number;
    traceEnabled: boolean;
    selectedMemorySpace: "code" | "iram" | "sfr" | "xram";
    debugger?: { breakpoints: number[]; breakpointOptions?: { address: number; enabled: boolean; hitCount: number }[]; watchpoints: { space: "iram" | "sfr" | "xram"; address: number }[] };
  };
  updatedAt: number;
}
```

`CpuSnapshot` 保存 PC、累计步数/周期、IRAM、SFR、XRAM 和外设内部状态；CODE 由固件重建。外设状态包含数字输入、计数边沿、中断优先级栈、串口收发队列及有界输出历史。加载、复位、单步、编辑、输入、暂停、停止和执行错误时保存，连续运行期间每 2 秒保存。

v2 记录升级到 v3 时保留 CPU v2 与所有原有配置；未配置选项的断点默认启用、每次到达都暂停。v1 记录升级时保留 PC、计数器、内存和固件，外部输入初始化为 `0xFF`，串口队列与中断在服务状态从确定性默认值开始。损坏的 CPU 状态继续使用固件降级恢复。JSON 导入最多 1 MiB，先校验所有版本、缓冲区、数值、调试设置和 SHA-256，成功后再替换当前工作区；解析函数自身不写 IndexedDB。

完整快照不兼容或损坏时，保留可验证的固件和设置，并从 CPU 复位状态重新启动。用户可以清除全部本地工作区。`navigator.storage.persist()` 仅作为尽力请求，浏览器拒绝时仍可正常运行。

## 4. 8051 语义基线

### 4.1 存储器和寄存器

| 空间 | 大小 | 行为 |
| --- | ---: | --- |
| CODE | 65,536 字节 | 固件装载到 `0x0000`，其余填 `0x00` |
| IRAM | 128 字节 | 间接地址只允许 `0x00..=0x7F` |
| SFR | 经典 8051 已定义地址 | 未定义 SFR 严格报错 |
| XRAM | 65,536 字节 | 供 `MOVX` 使用 |

- ACC、B、PSW、SP、DPL、DPH 只存在于 SFR；
- R0–R7 只存在于 PSW 选择的 IRAM 寄存器组；
- P0–P3 复位为 `0xFF`，SP 复位为 `0x07`，其他已实现 SFR 使用确定性复位值；
- 新建 CPU 时 RAM 为零；`reset()` 保留 IRAM/XRAM，恢复 SFR、PC 和计数器；
- 位地址 `0x00..=0x7F` 映射 IRAM `0x20..=0x2F`；高位地址只允许标准可位寻址 SFR。

### 4.2 指令执行

- 256 个编码位置中 255 个有效，`0xA5` 唯一非法；
- 操作数和 post-PC 先读取，再执行语义；
- PC、DPTR 和相对地址使用 16 位 wrapping；
- 相对偏移是相对 post-PC 的有符号 8 位数；
- AJMP/ACALL 使用 post-PC 所在 2 KiB 页；
- 调用先压返回地址低字节，再压高字节；RET/RETI 反向弹出；
- 栈经 128 字节 IRAM，落在 `0x80..=0xFF` 严格报错；
- `MOVX @Ri` 使用 `(P2 << 8) | Ri`，且不修改 P2；
- `MOVC A,@A+PC` 使用预推进 PC；
- 每条成功指令后根据 ACC 统一重算 PSW.P；
- 除零时 CY=`0`、OV=`1`，ACC/B 保持；
- 指令错误不增加步数或周期，PC 保持在故障指令；
- 周期采用经典 12 振荡周期架构的机器周期，驱动定时器和串口；中断响应计 2 个机器周期。指令边界模型不等同于精确总线时序。
- `MOV C,bit` 使用 1 个机器周期，`MOV bit,C` 使用 2 个机器周期；两者不能因操作数相近而共用计时。

## 5. 浏览器工作台

界面必须提供：

- 文件选择和拖放；
- 固件名称、大小和 SHA-256；
- 运行、暂停、单步、复位和最大执行单元；
- PC、ACC、B、PSW、SP、DPTR、R0–R7、步数和周期；
- CODE、IRAM、SFR、XRAM 的 256 字节窗口；
- 最近 1,000 条跟踪记录；
- 执行错误、停止原因、保存状态和持久存储提示；
- 清除本地工作区；
- 反汇编、断点、内存变化观察点、步过和运行至地址；
- 暂停时编辑寄存器和可写内存；
- 数字端口输入、串口输入/输出、定时器及中断状态；
- 本地工作区下载和导入。

默认单次运行预算为 1,000,000 个 `cpu.step()` 执行单元，包含成功指令、中断响应和空闲周期，以保证空闲固件也有执行上限；CPU 指令计数只累计成功指令。`StepLimitReached`、`Paused`、`Breakpoint`、`Watchpoint`、`RunToAddress`、`StepComplete`、`PowerDown` 和 `CallStackInvalidated` 都是正常停止。非法调试请求使用 `CommandRejected`，保持正在运行的 CPU；指令故障使用 `ExecutionFault`。

## 6. Cloudflare 配置

`wrangler.jsonc`：

- `assets.directory` 指向 `dist`；
- `not_found_handling` 使用 `single-page-application`；
- 没有 `main` 和数据绑定；
- `send_metrics` 与依赖元数据收集关闭。

生产安全头：

- CSP 默认只允许同源静态资源；
- `connect-src 'none'`；
- Worker 只允许同源或 Vite 生成的 blob；
- 禁止对象、表单提交、嵌入和无关浏览器权限；
- 哈希资源长期缓存，HTML 重新验证。

部署门禁：

```console
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run deploy:dry-run
npm run deploy
```

## 7. 实施阶段与里程碑

| 里程碑 | 内容 | 当前状态（2026-10-04） |
| --- | --- | --- |
| M1 Web 基础与部署 | React/Vite/TypeScript、静态资源、安全头、移除活动 Rust 工程 | 已完成 |
| M2 核心执行框架 | 存储器、SFR、复位、完整译码表、CPU API、Worker 协议 | 已完成 |
| M3 完整指令集 | 255 个有效编码、寻址、标志、栈、跳转和周期 | 已完成 |
| M4 浏览器工作台 | 固件选择、运行控制、状态/内存/跟踪显示 | 已完成 |
| M5 本地恢复与交付 | IndexedDB、损坏降级、跨浏览器 E2E、Cloudflare 部署 | 已完成 |
| M6 经典 8051 扩展 | HEX、反汇编、调试器、外设、工作区交换 | 已完成；180 项单元测试与 11 项 Chromium E2E 通过 |

原始排期基准为一名熟悉 TypeScript 和 8051 的开发者全职约 7–9 周；实际工期会受开发者熟悉程度、指令语义测试深度和浏览器兼容性要求影响。里程碑完成表示当前验收门禁通过，不表示所有未来差分验证或扩展功能已经完成。

M6 后续维护（2026-10-11）：内存地址草稿与读取结果分离，补充确认/取消、严格范围校验和翻页；修复哈希导航后的内存刷新及寄存器组标题。该批通过 192 项单元测试和 13 项 Chromium E2E。随后 KEIL 对照首批补充反汇编浏览、指令行断点和运行至行，该批通过 200 项单元测试与 14 项 Chromium E2E。第二批补充断点启停和每 N 次命中，工作区记录升级 v3，该批通过 231 项单元测试和 15 项 Chromium E2E。第三批增加 Step Out 与可信调用帧，当前 261 项单元用例及 17 项 Chromium E2E 已验证，详见功能迭代清单。

## 8. 测试与完成标准

### 8.1 自动化覆盖

- 256 项操作码元数据，`0xA5` 唯一非法；
- 每个有效编码都进入已实现语义，不得返回 `UnsupportedOpcode`；
- CODE/IRAM/SFR/XRAM、位寻址、寄存器组和复位；
- ADD/ADDC/SUBB、奇偶、乘除、除零和十进制调整；
- 相对跳转、PC 回绕、AJMP/ACALL 页、调用/返回栈顺序；
- `MOV direct,direct` 机器码操作数顺序、MOVC、MOVX 和 JBC；
- 工作区保存、完整恢复、清除和损坏快照降级；
- 真实浏览器加载固件、单步、刷新恢复；
- 浏览器网络记录只允许同源静态 GET，不出现固件上传或 POST/PUT；
- Wrangler 干运行必须显示无 bindings。

### 8.2 交付标准

- 打开部署 URL 后无需账号即可选择固件；
- 固件内容不离开浏览器；
- 255 个有效编码均有明确执行路径；
- 连续运行可暂停且不会阻塞主界面；
- 刷新后恢复固件、CPU、IRAM、SFR、XRAM 和设置；
- 清除操作删除本地工作区；
- 类型、Lint、单元测试、浏览器测试和生产构建全部通过；
- Cloudflare 项目不包含服务端入口或数据绑定。

## 9. 维护规则

- 功能合并时同步更新 README 的已实现能力、本文件的里程碑状态和相关测试；
- 新增或修正指令语义时必须补充回归测试，并记录与 Intel 资料或硬件行为之间的已知偏差；
- 任何网络请求、Cloudflare 服务端入口或数据绑定都属于隐私架构变更，必须先更新本文档并重新完成隐私验收；
- IndexedDB 或 `CpuSnapshot` 结构变化必须提升对应版本，并验证兼容恢复和降级路径；
- 历史固件样本的来源、许可和权威预期确认后，补充 fixture 说明；确认前不得将其作为唯一正确性依据。

## 10. 后续方向

参照 KEIL C51 / µVision 按 [功能对照](KEIL_PARITY.md) 分批完善调试工作流；工程/构建和源码级调试须先确认工具链许可及真实调试元数据。按独立需求评估汇编器、8052、多个本地项目、PWA 和差分测试。任何扩展不得静默改变经典 8051 模式或无后端隐私边界。当前 feature 状态见 [功能迭代清单](FEATURE_ROADMAP.md)。

### 10.1 当前行为决策

- HEX 的标准类型 `00..05` 均验证格式和校验和；扩展地址及入口必须处于 64 KiB CODE。稀疏间隙填零，入口元数据不会覆盖硬件复位 PC `0x0000`；重叠数据、EOF 后记录和不完整文件拒绝加载。
- 断点在中断/电源状态仲裁后的指令取指前检查；不把中断响应、idle 或掉电单元算作指令命中。从该断点继续时仅跳过该地址下一次真正执行的指令，中途进入 ISR 不消耗这次跳过。观察点比较单个执行单元前后的存储字节变化，涵盖外设对 SFR 的变化，不捕获字节值未变的写入。SFR 观察点检查锁存器，与内存面板一致；串口接收可监视 SCON.RI，外部引脚变化在 GPIO 面板查看。
- 断点可禁用并保留阈值，每 N 次待执行指令命中暂停，达到阈值后计数归零。计数进度跨暂停/预算停止/继续保留；复位、加载、恢复和编辑 PC 清空全部进度，修改/移除某断点只清空该地址进度。相同配置重发及改动其他观察点不清空进度。显式单步不触发或累计地址断点；步过调用的内部执行正常累计。JSON/IndexedDB 只保存启停和阈值，不保存进度。
- 步过调用使用返回地址与原 SP，避免嵌套调用或中断产生提前完成。普通指令使用单步语义，临时目标不保存进工作区。
- T0/T1 支持 13 位、16 位、8 位重载和 T0 分拆模式；T1 模式 3 停止计数。分拆模式下 T1 可用作串口时钟，但不再使用被 TH0 占用的 TR1/TF1。
- 中断覆盖 INT0、T0、INT1、T1 和串口；先高优先级再低优先级，同级按经典轮询顺序，最多低/高两层嵌套。IE/IP 访问和 RETI 后推迟一个指令边界，RET 不释放中断在服务状态。
- 普通端口读取返回锁存器与外部输入的按位 AND；读改写操作读取锁存器。输入采用数字电平，不能推导真实开漏、上拉、电压或电流。
- UART 使用机器周期或 T1 溢出来推进帧，支持 REN、TI/RI、SMOD 和第九位输入。收发队列及输出历史有界；串口控制台是数字帧模型，不提供串口硬件接线或精确位波形。
- 空闲停止取指，外设和中断继续推进；经典掉电停止时钟，需要复位。输入、暂停和复位通过 Worker 消息处理，不阻塞主界面。
- 清除工作区先禁止后续保存并停止 Worker，再删除 IndexedDB，避免页面退出事件重新写入。保存队列按顺序写入，加载代次用于丢弃旧固件的延迟消息。

### 10.2 可信调用帧与 Step Out

- 调用历史是 `CpuViewState.callStack` 中的临时调试状态，不属于 CPU/工作区快照；当前记录版本保持 v3、核心快照 v2。复位开始有已知空栈；恢复快照时不推测旧帧，标记早期历史未知。
- 成功 ACALL/LCALL 记录调用地址、入口、post-PC、调用前 SP 和返回槽 SP；成功中断响应记录中断源及被中断 PC。入栈仍遵循已有低字节先入、高字节后入规则，不改变执行语义。
- RET 只能验证 CALL 帧，RETI 只能验证中断帧；需 SP 位于帧顶、返回地址和退出后 SP 均吻合。RET 不释放中断在服务状态；误用 RET/RETI 仍执行原 CPU 语义，但不宣称调用栈可信。
- 普通平衡 PUSH/POP 可在返回槽以上操作；返回槽的直接、间接、寄存器组、位写入（含同值写入）、显式写 SP、手工改 PC、POP 越过返回槽、错误返回和栈回绕会丢弃旧帧，说明未知原因。失去历史后新发生的 CALL/中断可建立部分可信帧。
- 经典 128B IRAM 的越界栈访问仍严格报错；原子失败的压栈/返回不创建或移除帧。原有 8 位 SP 回绕行为保持，但不为回绕帧提供 Step Out。
- Step Out 选取当前最内层已验证帧，持续执行直到该帧经匹配 RET/RETI 移除；嵌套调用或中断、恰好到达返回地址的跳转不能提前完成。信任代次变化则以 `CallStackInvalidated` 停止。
- 断点在取指前停止，观察点在执行单元后检查；Step Out 完成检查随后执行，先于同边界的预算停止。运行期间可以暂停；无返回路径、idle 与掉电仍受预算/停止机制控制。中途停止会取消本次临时目标，再次点击跳出选择当时最内层帧。
- 调用帧最多 64 项，受经典 IRAM 容量进一步约束；只显示机器地址，不声称拥有函数符号、C 局部变量或任意历史栈展开能力。

## 11. 参考资料

- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)
- [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Intel MCS-51 User's Manual（1981）](https://www.bitsavers.org/components/intel/8051/MCS-51_Users_Manual_Jan81.pdf)
- [Intel MCS-51 User's Manual（1994）](https://www.bitsavers.org/components/intel/8051/MCS-51_Users_Manual_Feb94.pdf)
- [Intel 8051 Preliminary Architectural Specification（1980）](https://www.bitsavers.org/components/intel/8051/8051_Microcomputer_Preliminary_Architectural_Specification_May80.pdf)

## 只读表达式实现

`core/expressions.ts` 提供有界词法分析和优先级解析；Worker 的 `EvaluateExpressions` 一次性采样，`WatchResults` 带请求编号、PC 和指令计数。SFR 只读锁存器，禁止外设访问钩子。App 作废旧请求并在状态更新/页面导航后刷新，WatchPanel 保留独立草稿与逐行错误。表达式列表不持久化，现有工作区/快照格式保持不变。完整语义见 [WATCH_EXPRESSIONS.md](WATCH_EXPRESSIONS.md)。
