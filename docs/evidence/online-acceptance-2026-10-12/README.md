# EmuC51 现网验收 · 2026-10-12

结论：本轮有界 Chromium 现网验收 **15/15 通过**，未确认应用代码缺陷。验证对象为 `https://emuc51.kwgrg-01.workers.dev/`，使用云环境隔离浏览器、本地临时工作区和公开/合成源码；没有操作远端用户数据。

## 实际版本与访问

- 验收开始和结束均通过 Git 远端查询确认 master 为 `1a096b739e946218ad0d8102dd2358000f41dcfb`。
- 首次正常路径 GET 于 **07:51:45 UTC** 收到站点 HTTP 200；代理 CONNECT 也为 200。见 [原始响应头](initial-headers.txt)、[curl 日志](initial-curl.log)。未换代理、域名、IP 路径或绕过访问拒绝。
- 云环境 Chromium **151.0.7922.173**，桌面 1440×1000，布局回归另含 1280、820、390px；手机截图 390×844。
- 浏览器起初报 `ERR_CERT_AUTHORITY_INVALID`：环境新提供的 `/usr/local/share/ca-certificates/environment-proxy-ca.crt` 尚未在浏览器信任库可用。仅将此既有环境 CA 加入本次执行的 NSS 信任库，并沿用 `HTTPS_PROXY`。没有 `ignoreHTTPSErrors`、忽略证书开关、替换代理或生产安全配置修改。CA SHA-256：`C71B4D1E9D7775C538C688AB10CEA9CE417D7312E89838F9D15FF73256CD7FC3`。见 [TLS 验证日志](tls-verification.log)。成功浏览器响应记录于 [browser-probe.json](browser-probe.json)（07:53:39 UTC 响应）。
- 从该 SHA 本地重建，仅用于比对，未部署。现网 HTML、CSS、主 JS、模拟器 Worker、编译器 Worker、四阶段 SDCC 脚本、SDK files.js 共 **10 个资源**的浏览器响应内容 SHA-256 均与本地 dist 完全一致。见 [逐项哈希与网络汇总](asset-and-network-audit.json)。
- 父线程提供的 Workers Builds check `114710015589` / version `eab2ba76-3698-487e-ae2e-2f2d9af5c0f1` 未在本轮通过 Cloudflare API 独立读取；以上内容哈希是本轮版本一致性的实测证据。

## 已通过范围

| 范围 | 线上行为与证据 |
| --- | --- |
| 实际生产 CSP | `script-src 'self' 'wasm-unsafe-eval'`，`connect-src 'none'`，没有普通 `unsafe-eval`；真实编译直接受线上响应 CSP 约束，未用请求拦截改头 |
| 页面与导航 | 新中性工作台；1440/1280/820/390px 导航、aria-current、面板边界；窄屏内存内部滚动；键盘折叠/展开侧栏保留编译草稿；错误提示可关闭 |
| 单 C | 实际编译与原生 fixture 完整 IHX/CDB 一致；编辑、重复编译、语法错误 main.c:2、取消、重新成功、加载运行、刷新恢复 |
| C/SDAS | 实际混合编译与原生 fixture 完整 IHX/CDB 一致；改头文件和 C 后重编译，观察结果 14；跨 C/ASM 行断点、静态对象身份、ABI 值 4864/10/3、恢复 |
| 内置示例完整交互 | 单 C 和 C/SDAS 均编辑→编译→加载→源码断点→单步→长运行→手动暂停；混合 C 参数 5→9、ASM 加数 2→3，实际 P1=12；记录 PC 变化和截图 |
| 错误与隔离 | 语法错误、链接缺符号失败无可加载旧包；取消/编辑/离开编译面板作废结果；取消包读取的迟到数据不覆盖新固件；篡改/歧义/路径错误不替换当前固件 |
| 网络与隐私 | 15 项成功测试捕获 **155 次请求**，全部同源 GET、无请求体，源码哨兵未出现于 URL/请求体；0 pageerror/console.error、0 requestfailed、0 HTTP≥400。仅加载公开静态资源，未观察到源码发送 |

隐私结论限于本次记录的页面/Worker 行为，不声称证明任意未来程序路径；Cloudflare 仍能看到普通静态页面请求。验收证据之后通过 Git 保存的是公开测试材料，不是应用上传源码。

## 截图与可复核记录

- [现网首页](screenshots/home.png)
- [单 C 桌面调试](screenshots/single-desktop-debug.png) · [单 C 断点（全页）](screenshots/single-breakpoint.png)
- [C/SDAS 桌面调试](screenshots/mixed-desktop-debug.png) · [C/SDAS 断点（全页）](screenshots/mixed-breakpoint.png)
- [C/SDAS 内存](screenshots/mixed-desktop-memory.png) · [外设](screenshots/mixed-desktop-io.png) · [390px 窄屏](screenshots/mixed-mobile-debug.png)
- [12 项回归 JSON](results.json) / [日志](test-run.log)，[3 项补充 JSON](examples-results.json) / [日志](examples-run.log)
- [用例→证据目录索引](run-index.json)：每项包含 network.json、完整 Playwright trace.zip 和最终截图；内置示例另有 behavior.json。
- [验收脚本](harness/)：复制其中根配置/fixture 至仓库根、tests/online-acceptance 至 tests，创建 `/workspace/acceptance-evidence`，使用同一环境代理和正常受信任证书运行 `npx playwright test --config online.config.ts`。补充独立运行使用 `online-examples.config.ts`。当前 online.config.ts 扫描全部 15 项；首次记录是在补充脚本加入前执行的 12 项。
- 本轮没有 AGENTS.md 或本地 .agents/skills；已读取根 README、BROWSER_SDCC、MIXED_SDCC_PROJECT、neutral-workbench 截图说明和验证 JSON。

## 测试脚本修正及边界

第一次补充脚本误将执行预算 `0` 当作无限运行，实际产品明确规定为“不执行”，因此两个“运行中”断言失败；没有应用代码变更。修正为 `100000000` 后两例及旧结果隔离例全部通过。保留 [初次日志](harness-initial-run.log) 和 [初次结果](harness-initial-results.json)，不将脚本错误隐去或计为产品缺陷。

本轮没有重跑本地 676 单测/72 E2E，没有把旧测试或构建通过当作现网通过；本轮现网成功数量为 15。未验证 Firefox/WebKit、真实手机、低内存设备或任意复杂 C 工程。生产入口未暴露 Cloudflare version ID，需父线程关联 check 元数据时使用上述 SHA。本批未改应用代码、未合入 master、未单独部署、未扩展功能；证据分支仅用于持久化报告与截图。
