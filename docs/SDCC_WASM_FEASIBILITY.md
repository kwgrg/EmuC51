# SDCC 浏览器移植：有限核验记录

2026-10-11，结论：固定官方 SDK 与 SDCC 源码可取得；当前仓库仍没有可运行的浏览器 SDCC。此次只核验来源、原生驱动的进程边界、构建前提与组件许可，没有安装 emsdk 工具链、生成或分发 WASM，也没有更改 CSP、网络权限或加入后端。

## 可复核材料

- [官方 emsdk 4.0.19 标签](https://github.com/emscripten-core/emsdk/tree/4.0.19) 经 `git ls-remote` 解析为 `7b4e60e4bfcba326025e373024369eaa9904af55`。从该提交成功读取 `emscripten-releases-tags.json`，4.0.19 对应工具链 release `8b01e2ec3f33e6b94842096d7312ce4ef5f33f6c`。这证明引导源码/版本记录可获得，不代表本环境已安装或运行 emcc。
- [Debian SDCC 4.5.0+dfsg-1 源包描述](https://deb.debian.org/debian/pool/main/s/sdcc/sdcc_4.5.0+dfsg-1.dsc) 与 [对应源码](https://deb.debian.org/debian/pool/main/s/sdcc/sdcc_4.5.0+dfsg.orig.tar.xz) 下载成功，11,061,180 字节，实际 SHA-256 `f7af2c454c398a70393cbbbbb9c809e21cedbeb7d284a0a445120743ebc873b8` 与描述文件一致，已解包检查。它是 Debian 的固定 DFSG 源码包，不称为未经处理的上游原包。
- 当前环境有 make/g++/Python，没有 emcc/emcmake、bison、flex 或 cmake。SDCC `configure.ac:63–89` 要求词法/语法生成器和 Boost graph 头文件；这些前提未补齐，未进行完整交叉构建。无 sudo，未修改系统目录。

## 真实源码给出的阶段约束

`src/SDCCmain.c:2459` 通过 `sdcc_popen` 调用预处理器，2084/2161 行通过 `sdcc_system` 调用链接器/汇编器；`src/SDCCsystem.c:354–408` 直接调用宿主 `system`/`popen`。`src/mcs51/main.c:966/972` 指定 `sdld`、`sdas8051`。因此不能将原生驱动原样编成一个 WASM 后就假定浏览器能运行外部进程。

下一次独立原型须至少打通 sdcpp → 编译器 → sdas8051 → sdld，显式调度各阶段并传递虚拟文件，打包固定头文件、启动代码和 small 模型运行库；先用当前两份真实样本比较 IHX/CDB。再量测产物体积、峰值内存、首次/连续构建、取消和隔离残留文件。当前 `connect-src 'none'` 和脚本策略需要针对具体加载方式验证；没有可运行原型前不扩大策略。不能用原生构建或 SDK 标签可访问代替浏览器实测。

## 实际许可检查（尚未分发编译器）

固定源码中的文件头已检查：`src/SDCCmain.c` 为 GPL-2.0-or-later；`support/cpp/libcpp/lex.cc`、`sdas/asxxsrc/asmain.c`、`sdas/linksrc/lkmain.c` 为 GPL-3.0-or-later；`device/lib/mcs51/crtstart.asm` 为 GPL-2.0-or-later 并带链接例外。根 `LICENSE` 指向 `doc/README.txt`，其中明确套件并非单一许可。运行库的链接例外不能自动扩展为编译器自身的分发例外。

后续选定打包组件后需逐项保留版权/许可、对应源码及构建改动，单独评估分发方式。本批仅附测试固件及已有运行库版权材料，没有向网页打包 SDCC/emsdk 二进制，也没有声称完成全套许可审计。

参考：[Emscripten 官方安装说明](https://emscripten.org/docs/getting_started/downloads.html)、[文件系统](https://emscripten.org/docs/porting/files/file_systems_overview.html)、[API 限制](https://emscripten.org/docs/porting/guidelines/api_limitations.html)。

## 实际启动移植验证：SDK 访问阻塞与原生阶段拆分

同日后续任务已明确要求优先推进浏览器编译。在 `feat/sdcc-wasm-prototype` 独立分支实际尝试，而非仅列出建议：

```sh
git clone --depth 1 --branch 4.0.19 https://github.com/emscripten-core/emsdk.git /tmp/emuc51-emsdk
git -C /tmp/emuc51-emsdk rev-parse HEAD
/tmp/emuc51-emsdk/emsdk install 4.0.19
```

克隆成功且提交与上文固定值一致。安装器解析到预期 release 后，在第一个 Node 工具依赖下载退出 1：

```text
Installing tool 'node-22.16.0-64bit'..
Error: Downloading URL 'https://storage.googleapis.com/webassembly/emscripten-releases-builds/deps/node-v22.16.0-linux-x64.tar.xz': <urlopen error Tunnel connection failed: 403 Forbidden>
error: installation failed!
```

这是明确的代理访问拒绝；没有换域名、镜像、URL 路径或跳过该检查来绕过。emcc 未安装，**源码交叉编译未能启动**，没有生成 WASM，也没有进入浏览器 Worker 验证。apt-cache 同时报告本机没有 flex/bison 候选缓存，且 `/etc/apt/apt.conf.d/80-applied-apt-retries` 不可读；没有改权限或绕过读取拒绝。尚未取得的宿主生成器/Boost 依赖仍为后续前提，不用它们掩盖 SDK 的第一阻塞。

### 阻塞期间实际完成的验证

新增可重复执行的 [原生四阶段探针](../scripts/probe-sdcc-pipeline.mjs)，不调用完整驱动去隐式启动其他阶段：

```sh
SDCC_ROOT=/tmp/emuc51-sdcc/root/usr node scripts/probe-sdcc-pipeline.mjs
```

真实执行顺序与参数、链接脚本已写进探针：

1. sdcpp：使用固定 4.5.0 mcs51/small 预定义宏、系统 include 路径，输出预处理文本。
2. sdcc `--c1mode -mmcs51 --model-small --iram-size 128 --debug -o main.asm`，通过标准输入读预处理文本，不调用宿主预处理/汇编/链接进程。
3. sdas8051 `-plosgffwy main.rel main.asm`。
4. sdld `-nf main.lk`，链接脚本设置 IRAM 0x80、HOME/XSEG/PSEG/ISEG/BSEG 和五个 small 模型库。

结果保存于 [机器可读证据](evidence/sdcc-native-pipeline.json)。counter 与 flow 的 IHX 都与真实基线逐字节一致；将初始化改为 7 后固件摘要变化；非法声明返回 `broken.c:2: syntax error: token -> ';' ; column 25`；错误后在新目录重建原程序再次逐字节一致。每个阶段有 20 秒/2 MiB 输出预算，临时目录独立且 finally 清理。这验证的是原生阶段协议，不是浏览器隔离、取消或性能。

**新确认的源码调试缺口：** stock 4.5.0 的 `--c1mode` 把 `fullSrcFileName` 设为空；`src/SDCCmain.c:1767` 只在 `options.debug && fullSrcFileName` 时打开 `.adb`。实测两份拆分构建都缺少 `M:` 和 `L:C$` 记录，尽管 IHX 一致。因此当前探针产物不能冒充已验证的源码调试包。后续需在固定源码上实现并审查 c1 模式的显式源文件身份/调试输出补丁，保留原始 #line 关系，再与正常驱动 CDB 比较；不能手工伪造缺失记录。

### 资产、许可、资源及恢复条件

探针列出所用五个 `.lib` 和 `8051.h` 的实际 SHA-256，合计 **824,578 字节**（未压缩）。这仅为本样本的库/头文件输入，不包含工具链 WASM、完整标准头文件或其他预加载资源；不能当作最终下载包体。`8051.h` 文件头实际为 GPL-2.0-or-later 加链接例外。其他已检查组件许可见上文；这份清单仍不足以宣布未来整套浏览器编译器的分发材料齐备。

- 当前只提交自有探针、记录及资产元数据；不提交第三方二进制/库/头文件，不改变应用和 CSP，不引入服务器或源码上传。
- 恢复交叉构建所需的最小条件：获准访问官方 emsdk 引导及其固定 release 依赖，或由环境提供方预装来源与摘要可核验的完整 Emscripten 4.0.19；不能将换下载路径当作网络拒绝的解决办法。之后按可信仓库安装任务目录内的 flex/bison/m4/Boost 等开发依赖，并记录各版本/来源。
- 完整交叉构建配方尚未验证，不能把原生探针称为已可用的 WASM 构建脚本。恢复后须先选出仅 mcs51 的目标，分别交叉编译工具、验证预处理输入及虚拟 FS，再处理上述 CDB 缺口。
- Browser Worker 的编辑编译、错误、取消、二次构建、CSP 和实际内存峰值均**未运行/未测量**。下一原型可从每阶段新模块、每次新 Worker、256 MiB 单模块堆上限与 20 秒总任务超时开始试验；这些是待测预算，不是已证明能容纳 SDCC 的容量承诺。取消须 terminate Worker，旧任务身份不能接受结果；二次构建必须以真实 E2E 验证。
- 发布前还需提供实际分发组件逐项许可/版权、对应源码包（含移植补丁）、构建配方、运行库来源和再现结果。现阶段不满足，故不将任何编译器资产合入自动发布主线。
