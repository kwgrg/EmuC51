# 真实 SDCC 静态符号样本

2026-10-11 使用现有 Debian 官方原生 SDCC 4.5.0 #15242 (Linux) 实际运行：

```sh
SDCC_BIN=/path/to/sdcc node scripts/build-sdcc-bundle.mjs symbols.c empty-output-directory
```

固定选项 `-mmcs51 --model-small --iram-size 128 --debug`，未新增 SDK 或其他编译器下载。输出目录重新构建两次，清单/CDB/IHX 逐字节一致。四个可导入文件为 symbols.c、symbols.ihx、symbols.cdb、emuc51-sdcc.json。

用于验证全局/文件静态/局部 static 作用域、同名 ACC/shadow、DATA/IDATA/XDATA/CODE/SFR、1/2/4 字节及字符数组，及 pointer/struct/BIT/未链接 extern/越界 IDATA 的保守不可用处理。outside_classic 只有声明，不被程序访问；不是启用 8052 高 IRAM 的样本。optimized_unused 在此真实构建仍有链接地址，不能仅凭名字断言“已优化丢失”。参数/普通局部可能完全不出现在该配置的 CDB 中，不人工补造。

运行库版权及链接例外沿用 [原包材料](../sdcc-counter/SDCC-LIBRARIES-COPYRIGHT)。未分发编译器二进制；此 C 源码及测试为本项目新增。
