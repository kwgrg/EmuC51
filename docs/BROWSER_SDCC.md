# 浏览器 SDCC 4.5.0 移植（开发分支验收）

2026-10-12：已从固定源码实际构建四个 WASM 阶段，在 Chromium Dedicated Worker 中编译单文件 C 和多 C + SDAS8051 工程。**当前生产 CSP 未改动，功能未合入/上线；本地成功测试显式使用待批准的 `wasm-unsafe-eval` 策略。** 不能把本地测试当成现网可用。

## 使用与范围

BIN_INSPECTOR 的 C 编译面板可编辑单文件示例、C + SDAS 示例，或编辑已加载的、受摘要绑定的混合工程。按「编译 C 工程」后，成功产物可显式加载或下载构建包。加载后沿用现有 IHX/CDB 校验、源码行断点、符号观察与工作区保存。单文件下载 `emuc51-browser.build.json`、混合下载 `emuc51-project.build.json` 均可通过原产物入口重新导入。

草稿是当前面板的临时状态，离开面板/切换工作区会重建；成功加载的源码随工作区保存。没有文件树创建、任意构建参数、任意库/链接脚本、完整 A51、源码语句步进或局部变量调试。工程文件、头文件和指令限制沿用[最小混合工程协议](MIXED_SDCC_PROJECT.md)。单文件只允许规范 basename，默认固定 `<8051.h>` / `<stdint.h>`；其他头文件必须在混合清单内。

目标始终是 classic 8051、small、128 字节 IRAM；不把 128B 默认扩展为其他芯片的配置。工具链不是手写 C 转换器，不依赖外部服务器/本地 bridge，也不上传源码。

## 真正运行的阶段

1. 固定 SDCC 源包中的 GCC 12.1.0 `cc1 -E -quiet` 预处理前端：固定宏、只读 SDK 文件和清单内头文件。
2. `sdcc --c1mode --c1-source <原路径> -mmcs51 --model-small --iram-size 128 --debug`：标准输入为上一步的真实预处理输出。
3. `sdas8051 -plosgffwy`：真实生成 REL、ADB、LST；LST 也传递给带 `-u` 的链接器。
4. `sdld -nf`：固定链接脚本，入口 REL 最先，固定 small 模型运行库。

没有调用原生 system/popen/exec，也没有把会启动 cc1 的 cpp 驱动分发给浏览器。`thisProgram` 明确为各阶段名称；尤其 `sdld` 用程序名判定目标，不能省略。

`c1-source.patch` 使用编译器既有 `processFile` 读取原始源文件并建立模块名，恢复既有调试生成路径；没有手工补写 CDB 记录。原生补丁探针对 counter/flow 的 IHX **和完整 CDB** 逐字节匹配正常驱动。真实 Chromium 测试还比较完整混合工程的 IHX/CDB，并修改头文件重编译、运行验证结果。

## 隔离、错误与资源约束

- 每次请求一个新 Worker，每阶段一个新的 Emscripten 模块/虚拟文件系统；每个模块只调用一次 main。中间文件显式复制，不复用上一构建的文件。
- 主线程请求号、Worker 对象、草稿对象和工作区代次共同核对；编辑、取消、切换工作区、卸载立即终止 Worker并作废产物。开始新任务先作废上次成功结果；加载时再次检查当前草稿身份。
- 30 秒主线程硬超时，直接 terminate。输出/单个阶段产物各最多 1 MiB，传递的工程虚拟文件合计最多 4 MiB；源文件协议保留 64 Ki 字符/8192 行等现有上限。
- 每个 WASM 模块最多 256 MiB 线性内存，栈 2 MiB，允许内存增长。此上限不是整个浏览器进程的 RSS 上限；低内存设备尚未验证。
- 原始编译器诊断保留真实文件/行/列，不推造列号。任何阶段失败、超量、取消或校验失败不产生可加载固件；不会悄悄载入旧包。

## CSP 与加载方式

工具链 JS 内嵌 WASM，`files.js` 内嵌固定头文件/库的 base64；通过同源静态 ES 模块加载。整个应用仍可保持 `connect-src 'none'`，没有 fetch/XHR 取得 WASM/用户源码。

现有 `script-src 'self'` 的真实拒绝已记录在 [生产策略探针](evidence/sdcc-browser-production-csp.json)。唯一建议变更是 `script-src 'self' 'wasm-unsafe-eval'`，允许 WASM 实例化；不加入 JavaScript `unsafe-eval`、外部脚本域、外部连接或跨源隔离头。Emscripten 使用 `DYNAMIC_EXECUTION=0`。**批准前 `public/_headers` 保持原值。**

本地测试策略仅由开发者显式启用：

```sh
npm run build
EMUC51_TEST_WASM_CSP=1 EMUC51_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- --project=chromium
node scripts/sdcc-wasm/benchmark.mjs --allow-wasm
# 不传 --allow-wasm 验证原生产策略确实拒绝编译：
node scripts/sdcc-wasm/benchmark.mjs
```

## 固定来源、许可与重建

[SDK 下载恢复证据](evidence/sdcc-sdk-restored.json)包含官方 URL、字节数、固定 emsdk 提交、实际安装日志和 emcc 版本。Node 归档为 30,425,588 字节；SDK 工具链归档为 354,201,528 字节，均实际下载/解包/安装成功。没有代理/镜像替换。SDK 安装器删除了后一个归档，因此不声称取得它的归档 SHA-256。SDCC 源包和 Debian 开发依赖则逐项检查固定 SHA-256。

```sh
python3 scripts/sdcc-wasm/build.py /tmp/NEW-build /tmp/NEW-output
python3 scripts/sdcc-wasm/package.py /tmp/NEW-build /tmp/NEW-output public/sdcc/4.5.0-r1
```

需要 Debian amd64、git/make/gcc/g++/Python/tar/patch/dpkg-deb；不修改系统目录。recipe 下载固定 SDK、源码和生成器/Boost/运行库包；源码补丁明确保存在同目录。`libiberty` 的 psignal 补丁只修正 musl 头文件要求的 const 参数；旧 config.sub 增加精确 Emscripten 三元组识别；cc1-signatures.patch 修正四个上游前端 stub 的函数签名，保留原有断言，不用错误的 WASM 函数类型掩盖未实现路径。GCC 构建期 genversion 用宿主 g++，实际预处理器和依赖用 emcc/em++；不把生成器 WASM 当作宿主可执行程序。

分发清单与版权见 [NOTICE](../public/sdcc/4.5.0-r1/NOTICE.txt) 和 [逐文件 SHA-256/大小](../public/sdcc/4.5.0-r1/SHA256SUMS.json)。同一静态目录提供完整固定 SDCC 源包、实际 Boost 头文件源码、Emscripten 运行时/glue 源码、移植补丁与浏览器桥接源代码、可复现构建/打包配方、GPL2/GPL3 及各组件版权文本。不会把运行库链接例外当作编译器分发豁免，也没有分发非自由 PIC 部件。

工具链和对应源码构建材料均为开发产物，只有完成检查与所需策略批准后才可随现有静态部署发布。生成文件中可能含构建路径，不宣称不同目录下的整个编译器资产 bit-for-bit 相同；验收比较实际固件/CDB，并保留本次分发文件的确切哈希。

## 测量与剩余边界

[性能证据](evidence/sdcc-browser-benchmark.json)记录冷 Worker 和四次连续新 Worker 的墙钟时间、编译阶段时间、WASM 线性内存高水位、10ms 采样渲染进程 RSS、取消和网络请求。RSS 包含页面/Worker/JIT 等开销且采样可能漏掉瞬时峰值，不能当作精确分配器高水位；也不把 WASM 线性内存当成整个浏览器内存。

Chromium 是实际验证的浏览器；Firefox/WebKit 和真实手机尚未验证。30秒超时机制有定时器单测，实际 Worker 取消有浏览器测试；没有声称跑遍任意复杂工程或证明编译器没有资源耗尽漏洞。原生测试成功不是浏览器成功的替代，当前浏览器证据明确要求本地测试策略。
