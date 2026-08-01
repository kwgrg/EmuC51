# EmuC51 Web/Cloudflare 实施基线

- 架构版本：Web v1
- 更新日期：2026-08-01
- 运行位置：用户浏览器
- 托管方式：Cloudflare Workers Static Assets
- 生产地址：<https://emuc51.kwgrg-01.workers.dev>
- 服务端数据存储：无

本文档是 EmuC51 后续开发和验收的基准。本项目已经从 Rust 本地 CLI 路线切换为 TypeScript 浏览器单页应用；Git 历史保留原 Rust 骨架。

## 1. 产品目标与边界

用户打开网页后即可选择本地 8051 裸二进制固件，完成单步、连续运行、暂停、复位、状态查看和内存检查，无需安装或登录。

v1 包含：

- 最大 64 KiB 裸二进制固件；
- 经典 8051 CPU、存储器、SFR、位寻址和 255 个有效操作码编码；
- Web Worker 后台执行；
- 浏览器工作台和最近 1,000 条内存态指令跟踪；
- 最近一个完整工作区的 IndexedDB 自动保存和恢复；
- 无后端 Cloudflare 静态部署。

v1 不包含：

- Intel HEX、8052 和厂商扩展；
- 定时器、串口、中断、GPIO 电气行为和精确波形；
- 断点、观察点、源码级调试和反汇编编辑；
- 用户账号、多项目、跨设备同步、分享链接、PWA 和离线首次打开。

## 2. 系统架构

```text
本地 .bin 文件
  → 浏览器 File API 读取与 64 KiB 校验
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
}
```

Worker 使用带 `requestId` 的可判别联合协议，支持：

- `LoadFirmware`、`RestoreWorkspace`；
- `Reset`、`Step`、`Run`、`Pause`；
- `ReadMemory`、`CreateSnapshot`；
- `Ready`、`StateChanged`、`TraceBatch`、`MemoryData`；
- `SnapshotCreated`、`Stopped`、`ExecutionFault`。

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

数据库名为 `emuc51`，版本 1，只保存键 `current`：

```ts
interface WorkspaceRecord {
  schemaVersion: 1;
  coreStateVersion: 1;
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
  };
  updatedAt: number;
}
```

`CpuSnapshot` 保存 PC、累计步数/周期、IRAM、SFR 和 XRAM；CODE 由固件重建。加载、复位、单步、暂停、停止和执行错误时保存，连续运行期间每 2 秒保存。

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
- 周期是经典 12 振荡周期架构的名义机器周期，不驱动外设。

## 5. 浏览器工作台

界面必须提供：

- 文件选择和拖放；
- 固件名称、大小和 SHA-256；
- 运行、暂停、单步、复位和最大步数；
- PC、ACC、B、PSW、SP、DPTR、R0–R7、步数和周期；
- CODE、IRAM、SFR、XRAM 的 256 字节窗口；
- 最近 1,000 条跟踪记录；
- 执行错误、停止原因、保存状态和持久存储提示；
- 清除本地工作区。

默认单次运行上限为 1,000,000 条成功指令。`StepLimitReached` 和 `Paused` 是正常停止，`ExecutionFault` 是错误。

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

| 里程碑 | 内容 | 当前状态（2026-08-01） |
| --- | --- | --- |
| M1 Web 基础与部署 | React/Vite/TypeScript、静态资源、安全头、移除活动 Rust 工程 | 已完成 |
| M2 核心执行框架 | 存储器、SFR、复位、完整译码表、CPU API、Worker 协议 | 已完成 |
| M3 完整指令集 | 255 个有效编码、寻址、标志、栈、跳转和周期 | 已完成 |
| M4 浏览器工作台 | 固件选择、运行控制、状态/内存/跟踪显示 | 已完成 |
| M5 本地恢复与交付 | IndexedDB、损坏降级、跨浏览器 E2E、Cloudflare 部署 | 已完成 |

原始排期基准为一名熟悉 TypeScript 和 8051 的开发者全职约 7–9 周；实际工期会受开发者熟悉程度、指令语义测试深度和浏览器兼容性要求影响。里程碑完成表示当前验收门禁通过，不表示所有未来差分验证或扩展功能已经完成。

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

按需求评估 Intel HEX、断点/观察点、反汇编、外设、中断、8052、多个本地项目、工作区导入导出、PWA 和差分测试。任何扩展不得静默改变经典 8051 模式或无后端隐私边界。

## 11. 参考资料

- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)
- [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Intel MCS-51 User's Manual（1981）](https://www.bitsavers.org/components/intel/8051/MCS-51_Users_Manual_Jan81.pdf)
- [Intel MCS-51 User's Manual（1994）](https://www.bitsavers.org/components/intel/8051/MCS-51_Users_Manual_Feb94.pdf)
- [Intel 8051 Preliminary Architectural Specification（1980）](https://www.bitsavers.org/components/intel/8051/8051_Microcomputer_Preliminary_Architectural_Specification_May80.pdf)
