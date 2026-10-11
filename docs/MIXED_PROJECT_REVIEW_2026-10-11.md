# 混合工程最终一致性复查（2026-10-11）

基线：`68f423e4b30fc2227be33cc42a4c61f96c43c547`。限定在固定 SDCC 4.5.0 mcs51 工程的文件身份、构建产物和导入状态；没有扩展 ABI、构建参数或后端。本轮未复现需要修改生产代码的缺陷，仅补回归及本报告，不声称穷尽所有缺陷。

## 可复核证据

| 边界 | 实际验证 |
| --- | --- |
| 同名、大小写及规范化路径 | 核心测试拒绝不同目录的同名文件、Main.c/main.c、MAIN.asm/main.c 模块冲突、Shared.h/shared.h、输入路径大小写错配、点段、空段、重复输入；已有用例覆盖绝对路径、反斜杠与穿越 |
| 头文件变化 | 真实原生构建后修改头文件宏，再构建至新目录；头文件摘要和最终 IHX 摘要均改变。源文件及头文件内容改变但摘要不变时导入失败 |
| 缺失/重复模块及调试错配 | 核心测试拒绝缺失主/次 C 模块、重复 C 模块、未知 ASM 模块、未知源码和越界行；包括重算 CDB 摘要后仍拒绝无效模块/行映射。合法但无执行行的模块不强求断点 |
| 构建失败与旧产物 | 真实成功构建后破坏头文件；新目标不发布包，旧目标拒绝复用且旧成功包逐字节不变；已有测试覆盖无效 C 编译与全部成功后原子发布 |
| 来源绑定 | 核心/持久化测试验证入口、次源文件、头文件、项目配置、IHX/CDB 和当前固件摘要；工作区恢复重新验证，不只信任包名 |
| 重复、取消和晚到导入 | Chromium 实际重复导入同一个包，文件选择重置到入口；取消延迟 File.arrayBuffer 后换 BIN，释放旧读取不覆盖新固件，随后可再次正确导入混合包 |
| 单文件与混合工程往返 | Chromium 导入 version 1 四文件包、执行一步并导出 → 重复混合导入/观察静态对象 → 恢复原单文件工作区并刷新 → 恢复混合工作区。每次 CPU 快照逐字段相等，旧文件选择和符号样本撤下，混合完整调试包往返相等 |

测试位置：[`tests/core/sdcc-project.test.ts`](../tests/core/sdcc-project.test.ts)、[`tests/native/sdcc-project.test.ts`](../tests/native/sdcc-project.test.ts)、[`tests/persistence/sdcc-import.test.ts`](../tests/persistence/sdcc-import.test.ts)、[`tests/e2e/sdcc-project.spec.ts`](../tests/e2e/sdcc-project.spec.ts)。UI 使用生产构建、真实模拟器 Worker 和已归档原生构建包；延迟测试仅延迟文件读取，不伪造校验或 CPU 结果。

单文件兼容性指当前应用读取原 version 1 调试包、保存及恢复工作区，不代表旧应用能读取 version 2 混合包；没有更改工作区数据库 schema。摘要校验是完整性约束，不是编译来源签名，不能证明攻击者同时重写全部内容与摘要后的真实性。

## 复核命令

最终提交完整执行以下检查，结果及精确 SHA 在交付摘要记录。原生编译器使用已有经核验的 4.5.0 安装；必须设置 SDCC_BIN 才会运行全部原生编译测试。

```sh
npm run typecheck
npm run lint
SDCC_BIN=/tmp/emuc51-sdcc/root/usr/bin/sdcc npm test
npm run build
EMUC51_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- --project=chromium
XDG_CONFIG_HOME=/tmp/emuc51-config WRANGLER_LOG_PATH=/tmp/emuc51-wrangler-logs node node_modules/wrangler/bin/wrangler.js deploy --dry-run
git diff --check
```

## 阶段闭环与剩余依赖

已闭环：受限工程清单 → 真实外部 C/SDAS 编译链接 → 原子构建包 → 校验导入 → 跨文件调试 → 工作区保存/恢复。当前复查没有发现需要立即扩展产品范围的问题。

浏览器内编译仍依赖 Emscripten SDK 获取及后续 WASM 构建/浏览器验证；现有下载 403 未解除，本轮不重试，也未把尚未发生的环境配置变更视为放行。Firefox/WebKit 依赖不可用，本轮未运行。高级 ABI、任意库/链接参数及工程编辑器均未实现，属于另行确定范围的功能，而非本轮一致性缺陷。
