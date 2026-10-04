# EmuC51

EmuC51 是一个在浏览器中运行的经典 Intel 8051/MCS-51 模拟器。打开网页、选择本地 BIN 或 Intel HEX 固件，即可执行、反汇编和调试，观察定时器、中断、数字端口和串口；无需安装、无需账号，固件不会上传到服务器。

在线使用：[https://emuc51.kwgrg-01.workers.dev](https://emuc51.kwgrg-01.workers.dev)。生产站点单独发布；开发分支中的新功能需部署后才会在线提供。

## 隐私模型

- 固件由浏览器的 `File` API 直接读取，不经过上传接口；
- CPU、CODE、IRAM、SFR 和 XRAM 全部在 Dedicated Web Worker 中运行；
- 最近一个工作区保存在当前浏览器的 IndexedDB，刷新后自动恢复；
- 应用没有 Worker 后端、API、Cookie、遥测、KV、D1、R2 或 Durable Objects；
- 生产 CSP 使用 `connect-src 'none'` 阻止应用发起网络连接；
- “清除本地工作区”会删除浏览器保存的固件和运行状态。

Cloudflare 只托管编译后的 HTML、CSS、JavaScript 等静态应用文件。Cloudflare 可能记录普通页面请求，但用户选择的固件、CPU 状态和内存不会包含在这些请求中。

浏览器隐私模式、清理站点数据或存储回收可能导致本地工作区丢失。EmuC51 会尽力请求持久存储，但不能替代用户自己的固件备份。

## 已实现能力

- 不超过 64 KiB 的 BIN 或 Intel HEX/IHX 固件加载和 SHA-256 标识；HEX 校验记录、校验和、地址和重叠数据，支持全部六类标准记录；
- 64 KiB CODE、128 字节 IRAM、经典 8051 SFR 和 64 KiB XRAM；
- 16 位 PC、ACC、B、PSW、SP、DPTR 和四组 R0–R7；
- 经典 8051 的 255 个有效操作码编码，`0xA5` 明确作为非法操作码；
- 单步、步过、运行至地址、分批连续运行、暂停、复位和机器周期统计；
- 地址断点、内存变化观察点，暂停后编辑寄存器及 IRAM/SFR/XRAM；
- 全操作码反汇编、真实操作数和跳转目标、当前指令高亮；
- T0/T1 定时器模式 0–3、自动重载、门控和外部计数输入；
- 两级优先级的五个中断源、嵌套、中断向量及 RETI；
- P0–P3 数字输入，区分端口引脚读取和读改写锁存器语义；
- 串口模式 0–3、T1/SMOD 波特率推进、REN/TI/RI、独立收发缓冲区和本地串口控制台；
- PCON 空闲与掉电状态，空闲期间外设继续推进，掉电后可复位；
- 寄存器、CODE/IRAM/SFR/XRAM 查看和最近 1,000 条指令跟踪；
- IndexedDB 完整工作区自动保存、刷新恢复和损坏快照降级恢复；
- JSON 工作区导出和导入，保存外设及调试设置，导入前校验版本、内存和固件摘要，兼容 v1 工作区；
- Cloudflare Workers Static Assets 部署配置，无服务端入口和数据绑定；
- 核心、存储器、操作码、持久化和真实浏览器 E2E 测试。

## 使用方式

1. 打开 EmuC51 网页；
2. 拖放或选择 `.bin`、`.hex` 或 `.ihx` 文件；BIN 最大 64 KiB，HEX 文本最大 1 MiB，解码后的 CODE 最大 64 KiB；
3. 在 BIN_INSPECTOR 中单步、步过、运行，添加断点或运行至指定地址；
4. 在 SYS_MEM 中检查和修改内存，在 I/O_PORTS 中操作数字输入、注入串口数据并查看外设状态；
5. 下载工作区可备份当前状态；导入工作区会先验证完整文件，再替换当前状态；
6. 刷新页面时，最近工作区会从当前浏览器自动恢复。

8051 没有通用 HALT 指令。连续运行默认最多推进 1,000,000 个执行单元（指令、中断响应或空闲周期），达到上限属于正常停止；指令计数只统计成功执行的 CPU 指令。掉电状态会停止连续运行。

## 本地开发

要求当前 Node.js LTS 和 npm：

```console
npm install
npm run dev
```

质量检查：

```console
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e -- --project=chromium
```

Playwright 首次运行前需要安装对应浏览器：

```console
npx playwright install
```

已安装 Chromium 的受限环境可直接指定浏览器路径：

```console
EMUC51_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- --project=chromium
```

## Cloudflare 部署

项目使用 [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)，`wrangler.jsonc` 仅指向 `dist`，没有 Worker 脚本和存储绑定。

```console
npm run deploy:dry-run
npm run deploy
```

Wrangler 的依赖元数据收集和使用指标已在项目配置中关闭。

## 项目结构

```text
src/
├── core/          8051 CPU、外设、存储器、HEX、反汇编和调试器
├── components/    调试、数字输入和串口控制
├── worker/        浏览器 Worker 协议和分批执行循环
├── persistence/   IndexedDB 工作区及 JSON 导入导出
├── App.tsx        浏览器工作台
└── styles.css     响应式界面样式
tests/
├── core/          CPU、存储器和操作码测试
├── persistence/   IndexedDB 测试
├── e2e/           浏览器隐私与刷新恢复测试
└── fixtures/      历史固件样本
```

详细架构、8051 语义决策和验收标准见 [实施计划](docs/IMPLEMENTATION_PLAN.md)。
界面令牌、终端组件规范、页面模式和新增页面检查清单见 [设计系统](DESIGN.md)。
经典 8051 扩展的逐项验收状态见 [功能迭代清单](docs/FEATURE_ROADMAP.md)。

## 模拟边界

- 以经典 12 振荡周期架构的机器周期推进外设；不模拟精确总线时序、晶振波形、GPIO 电气特性或真实串口接线；
- 数字输入由用户注入；不模拟键盘、显示器、步进电机等器件的物理行为；
- 不支持 8052、厂商扩展、汇编器或源码级调试；
- 只保存最近一个浏览器本地工作区，不提供账号、多项目、云同步或分享；
- 不承诺离线首次打开或 PWA 安装。

## 固件样本

| 文件 | 大小 | 状态 |
| --- | ---: | --- |
| `tests/fixtures/firmware/testc51a.bin` | 21 字节 | 来源和权威预期待确认，目前仅作烟雾测试 |
| `tests/fixtures/firmware/testc51b.bin` | 236 字节 | 来源和权威预期待确认，目前仅作历史样本 |

样本来源、构建方式和许可得到确认前，不能单独用它们证明模拟器语义正确。
