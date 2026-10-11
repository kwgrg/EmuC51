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
