# 跨功能发布回归审查（2026-10-11）

审查基线：`90ea3e56144fca4c7c96ecb0507839adc98ff174`。本批仅增加可重复的跨流程测试和本报告，没有更改生产代码或新增项目模型。限定目标是状态隔离与用户操作闭环，不是穷尽式安全审计、性能或全部浏览器认证。

## 结论与证据

定向 Chromium 回归两条均通过，未发现材料性生产缺陷；不据此声称不存在其他缺陷。测试使用实际 Vite 生产构建、真实模拟器/汇编 Worker、仓库 ASM 示例及真实 SDCC 4.5.0 构建包。只在第二条测试延迟指定真实消息或 File.text 返回，未伪造 CPU、符号或覆盖数据。

可复核用例：[release-switching.spec.ts](../tests/e2e/release-switching.spec.ts)。

| 实际操作链 | 观察与断言 |
| --- | --- |
| 构建并加载 Timer/UART/INT0 ASM → 准备输入重放 → 入口断点 → DATA 30h 访问点 → 继续运行 | 断点准确停在 0040；访问点报告 DATA 0030；移除后继续，IRAM 30h..33h 为 01/1F/42/02 |
| 重放过程中记录覆盖 → 导出工作区及覆盖报告 → 重复采样 | 覆盖摘要绑定导出工作区实际固件 SHA，执行计数非零；重复采样仍为同一固件 |
| 修改 ASM 源码 → 导入外部 SDCC 包 → 观察 CDB 存储整数 | 旧 ASM 标签撤下并禁止执行旧产物；SDCC 导入撤下旧覆盖报告、关闭并清零覆盖、移除旧输入场景；count16 实际读取 4660 |
| SDCC → 导入原 ASM 工作区 → 重新构建 → 刷新 | SDCC 采样消失，恢复 CPU 快照逐字段相等；重放保留定义但调度关闭、投递记录清空；ASM 必须重建才恢复标签；刷新后再次撤下派生标签；覆盖不持久化 |
| 延迟 ASM 覆盖导出回复 → 换 SDCC → 释放旧回复 | 待报告时禁止重复导出；旧回复不触发下载，也不显示旧覆盖；新采样明确属于 symbols.ihx |
| 延迟 SDCC 符号采样 → 恢复 ASM 工作区 → 释放旧采样 | 不出现旧整数、符号或覆盖报告，CPU 保持恢复状态 |
| 延迟场景文件读取 → 取消 → 重新准备 → 换 SDCC → 释放旧文件 → 导出/刷新 | 已取消且已卸载的读取不安装旧场景；导出设置仍为新 SDCC 包且无场景，刷新后相同 |

## 相邻回归与实现检查

本次同时检查 `App.tsx` 的固件请求屏障、符号请求身份/绑定、覆盖请求号/代次/摘要、工作区恢复及串行保存；`useAsmBuild` 的 Worker 身份和源码匹配；输入面板的读取代次/卸载取消；模拟器 Worker 的场景校验代次。

完整回归还覆盖以下已有用例，而非在新测试中重复实现：

- `asm.spec.ts`：重复构建、取消后不接受结果、编辑/失败/刷新后的固件绑定。
- `sdcc.spec.ts`：取消文件导入、替换固件使导入失效、篡改/缺失构建文件不替换当前 CPU。
- `symbols.spec.ts`、`cdb-integers.spec.ts`：晚到观察、选择/取消、跨固件/源码绑定与恢复。
- `input-scenario.spec.ts`：重复重放一致性、暂停/取消、不重发输入、错误/超量场景。
- `features.spec.ts`：条件断点、访问观察点、固定覆盖导出、运行中采样、保存提交顺序。
- `emulator.worker.test.ts`：场景摘要在取消、复位、运行或换固件后晚到时不提交；覆盖摘要失败与恢复。

## 验证命令

定向用例已通过；最终提交须依次执行下列完整检查，通过后才按授权快进主线并核对远端 SHA 与 Cloudflare 终态。精确提交 SHA 和最终数量在交付摘要记录，不能把基线验证当成新提交验证。

```sh
npm run typecheck
npm run lint
npm test
npm run build
EMUC51_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- --project=chromium
XDG_CONFIG_HOME=/tmp/emuc51-config WRANGLER_LOG_PATH=/tmp/emuc51-wrangler-logs node node_modules/wrangler/bin/wrangler.js deploy --dry-run
git diff --check
```

## 未测与真正待办

- Firefox/WebKit 依赖仍不可用，未运行，不能从 Chromium 结果推定跨浏览器通过；本轮不重试受限下载。
- 浏览器内 SDCC 编译尚未实现；仅验证外部原生包导入及调试。SDK 访问未确认配置，本轮不下载，恢复条件见 [环境清单](SDCC_WASM_FEASIBILITY.md)。
- 尚未审查真实设备电气时序、其他 8051 衍生芯片、超出固定 profile 的编译器及调试格式。
- 本报告基线时多文件场景尚待选择；后续已按用户选择完成受限 C/SDAS 混合工程，见[混合工程说明](MIXED_SDCC_PROJECT.md)及[最终一致性复查](MIXED_PROJECT_REVIEW_2026-10-11.md)。任意库/链接配置仍未开放。
- 可独立继续的工作限于可复现缺陷、真实程序回归与现有边界维护；当前审查未发现需要立即实施的生产修复。

当前能力与更完整边界见 [核心能力清单](CURRENT_CAPABILITIES.md)。
