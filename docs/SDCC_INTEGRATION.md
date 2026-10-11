# SDCC 路线与当前验证边界

用户已选择优先 SDCC（2026-10-11）。当前产品仍是静态网页 + Dedicated Worker + 浏览器本地存储；Cloudflare 配置只有 assets，CSP `connect-src 'none'`。本批没有新增 API、源码上传、后端服务或浏览器 C 编译按钮。

## 已完成的真实验证

- 云环境 Debian 13，无 sudo，系统安装命令未执行。使用 Debian 官方仓库的 sdcc/sdcc-libraries 4.5.0+dfsg-1，核对发布 SHA-256 后解包到 `/tmp/emuc51-sdcc/root`，原生 SDCC 4.5.0 #15242 可运行；不改系统目录、不安装第三方 WASM 二进制。
- 真实执行 `sdcc -mmcs51 --model-small --iram-size 128 --debug main.c -o main.ihx`，生成 .ihx/.cdb/.rst/.map/.mem 等产物。独立工作目录再次构建，IHX 完全相同；源码、IHX、CDB、内存报告、包来源与版本/哈希已保存于 [sdcc-counter](../tests/fixtures/sdcc-counter/README.md)。
- 最初不指定 `--iram-size 128`，启动代码尝试清除地址 FF 的间接 IRAM，触发现有 classic 8051 范围错误。按目标配置重建后，真实启动与 P1 计数器循环通过。未修改核心来容忍错误目标。
- 真实失败编译 `unknown_identifier = 1` 返回非零退出状态，诊断 `broken.c:2: error 20: Undefined identifier 'unknown_identifier'`；该诊断只有行号，后续 UI 不应虚构精确列号。
- CDB 中有真实 `main.c:6 → AB`、`main.c:7 → AD` 等记录；目前只作为后续解析样本，不宣称已实现 C 源码定位、局部变量或源码单步。

## 最小交付顺序

1. **近期可在现有架构交付：外部 SDCC 构建包导入。** 用户本地运行固定版本真实 SDCC，显式导入源文件、IHX 和 CDB，包中记录版本/选项/摘要；复用当前 HEX 校验与来源关联保护。UI 明确为“导入外部 SDCC 产物”，不能叫“浏览器编译”。先实现真实源文件定位、PC 高亮和行断点；启动/运行库未映射地址显示无映射，一行多地址必须显式处理，暂不展开局部变量。需要新增有界 CDB 解析器、组合文件匹配与真实样例，当前尚未实现。
2. **浏览器本地编译独立技术验证。** 从固定 SDCC 源码用 Emscripten 构建所需预处理、编译、汇编、链接组件，独立 compiler Worker +虚拟文件系统，显式串联各阶段，验证不能依赖原生 fork/exec。须测资源体积、内存、取消、连续构建、文件隔离、头文件/运行库寻址及确定性。官方发布平台不等于已有即用浏览器包；目前未验证可直接无修改生成可用 WASM。当前 CSP 禁止 fetch/XHR，还须验证静态资源预打包及 WASM 执行/资源加载所需的最小策略调整，不能先放宽为外部任意连接。
3. **不默认引入服务器或本地 bridge。** 服务器编译会改变源码“不离开浏览器”的承诺，并需要隔离/运行配额/成本；本地 bridge 也涉及网络权限和授权。只有确有需要时提出具体方案，再由父任务取得产品决定。

编译器套件各组件和运行库许可不同，未来分发 WASM 需保留实际许可、对应源码与构建材料。此批没有向应用打包编译器；生成测试固件附原包运行库版权/例外说明。

参考：[SDCC 官方项目](https://sdcc.sourceforge.net/)、[官方手册](https://sdcc.sourceforge.net/doc/sdccman.pdf)、[CDB 格式](https://sourceforge.net/p/sdcc/wiki/CDB%20File%20Format/)、[Emscripten 文件系统](https://emscripten.org/docs/porting/files/file_systems_overview.html)、[移植 API 限制](https://emscripten.org/docs/porting/guidelines/api_limitations.html)。浏览器方案仍是待验证设计，不以原生构建成功代替浏览器可用性证据。
