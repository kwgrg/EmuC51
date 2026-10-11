# 真实单行多地址 SDCC 样本

2026-10-11 使用与 [计数器样本](../sdcc-counter/README.md) 相同的 Debian 官方 SDCC 4.5.0 #15242 (Linux) 包，实际执行 `scripts/build-sdcc-bundle.mjs` 生成；选项为 `-mmcs51 --model-small --iram-size 128 --debug`。原始源码/IHX/CDB 摘要见 emuc51-sdcc.json，可用同一脚本重新构建。

flow.c 第 3 行实际有两个函数定义。最终链接 CDB 为该行记录 A8、AA、B2；函数 two 的 AB 入口没有精确 C 行记录，测试必须保留这一空隙。不是人工拼接 CDB。

生成固件包含工具链运行库；其版权和链接例外见 [完整原包材料](../sdcc-counter/SDCC-LIBRARIES-COPYRIGHT)。没有分发编译器二进制。
