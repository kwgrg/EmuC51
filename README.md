# EmuC51

EmuC51 是一个在浏览器中运行的经典 Intel 8051/MCS-51 指令级模拟器。打开网页、选择本地裸二进制固件，即可单步或连续执行；无需安装、无需账号，也不会把固件上传到服务器。

在线使用：[https://emuc51.kwgrg-01.workers.dev](https://emuc51.kwgrg-01.workers.dev)

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

- 不超过 64 KiB 的裸二进制固件加载和 SHA-256 标识；
- 64 KiB CODE、128 字节 IRAM、经典 8051 SFR 和 64 KiB XRAM；
- 16 位 PC、ACC、B、PSW、SP、DPTR 和四组 R0–R7；
- 经典 8051 的 255 个有效操作码编码，`0xA5` 明确作为非法操作码；
- 单步、分批连续运行、暂停、复位和名义机器周期统计；
- 寄存器、CODE/IRAM/SFR/XRAM 查看和最近 1,000 条指令跟踪；
- IndexedDB 完整工作区自动保存、刷新恢复和损坏快照降级恢复；
- Cloudflare Workers Static Assets 部署配置，无服务端入口和数据绑定；
- 核心、存储器、操作码、持久化和真实浏览器 E2E 测试。

## 使用方式

1. 打开 EmuC51 网页；
2. 拖放或选择一个不超过 64 KiB 的 `.bin` 文件；
3. 使用“单步”“运行”“暂停”和“复位”控制模拟器；
4. 在寄存器、内存和指令跟踪面板查看结果；
5. 刷新页面时，最近工作区会从当前浏览器自动恢复。

8051 没有通用 HALT 指令。连续运行默认最多执行 1,000,000 条成功指令，达到上限属于正常停止。

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
├── core/          8051 CPU、存储器、操作码和类型
├── worker/        浏览器 Worker 协议和分批执行循环
├── persistence/   IndexedDB 工作区
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

## v1 限制

- 只支持裸二进制，不支持 Intel HEX；
- 不模拟精确总线时序、定时器、串口、中断和 GPIO 电气行为；
- 标准外设 SFR 只作为被动寄存器；
- 不支持 8052、厂商扩展、断点、观察点或源码级调试；
- 只保存最近一个浏览器本地工作区，不提供账号、多项目、云同步或分享；
- 不承诺离线首次打开或 PWA 安装。

## 固件样本

| 文件 | 大小 | 状态 |
| --- | ---: | --- |
| `tests/fixtures/firmware/testc51a.bin` | 21 字节 | 来源和权威预期待确认，目前仅作烟雾测试 |
| `tests/fixtures/firmware/testc51b.bin` | 236 字节 | 来源和权威预期待确认，目前仅作历史样本 |

样本来源、构建方式和许可得到确认前，不能单独用它们证明模拟器语义正确。
