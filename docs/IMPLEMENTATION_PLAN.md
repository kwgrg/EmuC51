# EmuC51 实施计划

本文档是 EmuC51 后续开发的规划基准，合并了初始实施计划与 8051 语义审核结果。

- 文档状态：已确定 v1 设计基线
- 基线日期：2026-07-28
- 当前阶段：早期工程骨架
- 目标平台：经典 Intel 8051/MCS-51
- 预计工期：一名熟悉 Rust 和 8051 的开发者全职约 6–8 周

工期会随指令语义验证深度、固件测试来源和开发者对 8051 的熟悉程度变化。

## 1. 项目目标

使用 Rust 实现一个能够正确执行经典 8051 裸二进制固件的指令级模拟器：

- 加载最大 64 KiB 的裸二进制固件；
- 模拟 CPU、存储器、SFR、寄存器组和位寻址；
- 完成经典 8051 指令的取指、译码和执行；
- 提供单步、有限步数运行、状态快照和名义机器周期统计；
- 提供可直接运行固件的命令行工具；
- 通过存储器、指令和固件三个层次的测试验证结果。

v1 以指令语义正确、行为确定、错误可诊断为优先目标，不追求振荡周期级硬件时序。

## 2. 当前仓库基线

### 2.1 已有实现

- `src/binfile.rs` 使用 `std::fs::read` 读取裸二进制文件；
- `src/memory.rs` 包含程序存储器和数据存储器原型；
- 程序存储器当前被拆分为 4 KiB 内部空间和其余外部空间；
- 数据存储器当前分配了 128 字节 IRAM、128 字节 SFR 后备空间和 64 KiB XRAM；
- 已有直接、间接、位和外部寻址的部分私有读取函数；
- `src/opcode.rs` 只有指令长度和函数类型的初始结构；
- `tests/helpfiles/` 下存在两个历史二进制样本。

### 2.2 尚未实现

- `lib.rs`、CPU 类型、复位和执行循环；
- 完整、公开且可写的存储器接口；
- 统一错误类型；
- 完整操作码元数据和指令语义；
- 正式 CLI；
- 单元测试、指令测试和固件集成测试。

### 2.3 已知基线问题

- `src/main.rs` 使用 Windows 风格硬编码路径；
- 文件读取使用 `unwrap()`；
- 多处存储器错误使用 `panic!()`；
- 位读取返回掩码而不是 `bool`；
- 程序存储器的内外分段没有对应的 EA 引脚或总线模型；
- `cargo test` 当前运行 0 个测试；
- `cargo clippy --all-targets --all-features -- -D warnings` 当前未通过。

## 3. v1 范围

### 3.1 纳入范围

- 经典 8051 CPU 指令集的 255 个有效操作码编码；
- 16 位程序计数器；
- ACC、B、PSW、SP、DPL、DPH；
- 四组 R0–R7 工作寄存器；
- 128 字节内部 RAM；
- 经典 8051 标准 SFR；
- 内部 RAM 和 SFR 位寻址；
- 64 KiB 程序存储器；
- 64 KiB 外部数据存储器；
- 经典 12 振荡周期架构的名义指令机器周期；
- 裸二进制固件加载；
- 单步、有限步数运行、跟踪和状态查看；
- 跨平台命令行路径处理。

### 3.2 不纳入范围

- Intel HEX；
- 振荡周期、引脚和总线波形；
- 定时器计数、串口收发和 GPIO 电气行为；
- 中断控制器、外部中断和中断优先级；
- 8052 上层 128 字节 IRAM 和定时器 2；
- 断点、观察点和交互式调试器；
- 图形界面、WebAssembly 前端；
- Keil 调试信息和源码级调试；
- 厂商扩展 SFR 和扩展指令。

`RETI` 在没有中断控制器时执行与 `RET` 相同的栈恢复操作，并保留以后通知中断控制器的扩展点。

## 4. 架构与语义决策

本节的内容是 v1 实现约束，不留给后续实现者重新选择。

### 4.1 存储器空间

| 空间 | 大小 | 地址类型 | v1 行为 |
| --- | ---: | --- | --- |
| CODE | 65,536 字节 | `u16` | 固件从 `0x0000` 装载，未覆盖区域填充 `0x00` |
| IRAM | 128 字节 | `u8`，有效范围 `0x00..=0x7F` | 直接和间接访问规则不同 |
| SFR | 定义于直接地址 `0x80..=0xFF` | `u8` | 仅实现经典 8051 已定义 SFR |
| XRAM | 65,536 字节 | `u16` | 供 `MOVX` 使用 |

- CODE 不再区分 4 KiB 内部和 60 KiB 外部空间，因为 v1 不模拟 EA 引脚或外部程序总线。
- CODE 和 XRAM 使用 `u16` 地址后，普通读取没有越界错误。
- PC、DPTR 加法、相对跳转及跨 `0xFFFF` 的取指按 16 位 wrapping 语义处理。
- 固件正好 65,536 字节时允许加载；超过该大小时返回加载错误。
- 空固件允许加载，其 CODE 内容全部为 `0x00`，运行时受步数上限保护。

### 4.2 直接、间接和位寻址

- 直接地址 `0x00..=0x7F` 访问 IRAM；
- 直接地址 `0x80..=0xFF` 访问 SFR；
- 间接地址仅允许 `0x00..=0x7F`，落在 `0x80..=0xFF` 时返回严格执行错误；
- 位地址 `0x00..=0x7F` 映射到 IRAM `0x20..=0x2F`；
- 位地址 `0x80..=0xFF` 仅允许映射到实际存在且可位寻址的 SFR；
- 位读取统一返回 `bool`，位写入接收 `bool`。

未定义 SFR 不使用通用 128 字节数组静默接受访问。直接访问未定义 SFR、或位访问不存在/不可位寻址的 SFR，都返回带地址上下文的错误。

### 4.3 标准 SFR 和复位值

v1 实现以下经典 8051 SFR：

| SFR | 地址 | 复位值 | v1 行为 |
| --- | ---: | ---: | --- |
| P0 | `0x80` | `0xFF` | 被动端口锁存器 |
| SP | `0x81` | `0x07` | CPU 栈指针 |
| DPL | `0x82` | `0x00` | DPTR 低字节 |
| DPH | `0x83` | `0x00` | DPTR 高字节 |
| PCON | `0x87` | `0x00` | 被动寄存器 |
| TCON | `0x88` | `0x00` | 被动寄存器 |
| TMOD | `0x89` | `0x00` | 被动寄存器 |
| TL0 | `0x8A` | `0x00` | 被动寄存器 |
| TL1 | `0x8B` | `0x00` | 被动寄存器 |
| TH0 | `0x8C` | `0x00` | 被动寄存器 |
| TH1 | `0x8D` | `0x00` | 被动寄存器 |
| P1 | `0x90` | `0xFF` | 被动端口锁存器 |
| SCON | `0x98` | `0x00` | 被动寄存器 |
| SBUF | `0x99` | `0x00` | 确定性被动寄存器 |
| P2 | `0xA0` | `0xFF` | 被动端口锁存器及 `MOVX @Ri` 高地址 |
| IE | `0xA8` | `0x00` | 被动寄存器 |
| P3 | `0xB0` | `0xFF` | 被动端口锁存器 |
| IP | `0xB8` | `0x00` | 被动寄存器 |
| PSW | `0xD0` | `0x00` | CPU 状态字 |
| ACC | `0xE0` | `0x00` | 累加器 |
| B | `0xF0` | `0x00` | B 寄存器 |

P0、TCON、P1、SCON、P2、IE、P3、IP、PSW、ACC 和 B 支持位寻址。

外设 SFR 在 v1 中只保存软件可见值：

- 不推进定时器；
- 不产生中断；
- 不模拟串口收发；
- 端口读取返回锁存值，不区分引脚输入与读改写指令；
- 不模拟外部总线对 P0 锁存器的电气或时序副作用。

### 4.4 CPU 状态的唯一数据源

- ACC、B、PSW、SP、DPL 和 DPH 只存放在 SFR 中；
- DPTR 通过 DPH/DPL 组合访问，不额外保存副本；
- R0–R7 只存放在当前 PSW.RS1/RS0 选择的 IRAM 寄存器组中；
- `Cpu` 仅额外保存 PC、累计成功步数、累计机器周期和存储器；
- `CpuState` 是读取上述数据后生成的快照。

禁止在 `Cpu` 与存储器中重复保存同一个架构寄存器。

### 4.5 初始化和复位

`Cpu::new()`：

- 接收已构造的程序存储器；
- 将 IRAM 和 XRAM 初始化为零，以获得可重复测试；
- 应用一次标准复位状态。

`Cpu::reset()`：

- PC 设为 `0x0000`；
- SFR 恢复表中的复位值；
- 累计步数和机器周期清零；
- 保留 CODE、IRAM 和 XRAM 内容。

该设计区分确定性的模拟器创建和真实 8051 的硬件复位；硬件复位不会清除内部 RAM。

### 4.6 PC、取指和分支

每次成功执行遵循：

1. 保存故障诊断用的起始 PC；
2. 读取操作码并查询元数据；
3. 按指令长度、使用 wrapping 地址读取全部操作数字节；
4. 计算指向下一条指令的 `post_pc`；
5. 在修改状态前完成可预判的地址和栈访问验证；
6. 将 PC 设置为 `post_pc`；
7. 执行指令，跳转指令可覆盖 PC；
8. 根据 ACC 统一更新 PSW.P；
9. 增加成功步数和名义机器周期。

具体规则：

- 相对偏移作为有符号 `i8` 加到 `post_pc`；
- AJMP/ACALL 的 11 位目标使用 `post_pc` 所在的 2 KiB 页；
- `MOVC A,@A+PC` 使用已经推进到下一条指令的 PC；
- LCALL/ACALL 压入 `post_pc`；
- `JMP @A+DPTR` 和所有 16 位地址加法按 wrapping 语义执行。

### 4.7 栈

- SP 是 8 位 SFR，算术使用 wrapping 语义；
- PUSH 和调用先递增 SP，再写 IRAM；
- 调用先压返回地址低字节，再压高字节；
- RET/RETI 先弹出高字节，再弹出低字节；
- POP 先读取当前 SP 指向的数据，再递减 SP；
- 栈存储严格经过 128 字节 IRAM，访问落在 `0x80..=0xFF` 时返回错误；
- 若软件直接将 SP 设为 `0xFF`，下一次递增 wrapping 到 `0x00`，该地址有效。

双字节调用必须在写入前验证两个目标栈地址，避免只压入一个字节后才失败。

### 4.8 PSW 标志

- 每条成功指令完成后，根据 ACC 中 1 的数量统一重算 PSW.P；
- 该规则也覆盖通过直接地址、POP 或交换操作修改 ACC 的情况；
- ADD/ADDC/SUBB 按手册更新 CY、AC 和 OV；
- INC/DEC 不改变 CY；
- CJNE 根据无符号比较更新 CY；
- MUL AB 清除 CY，结果高字节非零时设置 OV；
- DIV AB 清除 CY；除数非零时清除 OV；
- 除数为零时设置 CY=`0`、OV=`1`，并约定 ACC、B 保持执行前值；
- DA A 按经典 8051 十进制调整规则更新 ACC 和 CY。

### 4.9 MOVX 地址

- `MOVX @DPTR` 使用完整 DPTR 作为 16 位 XRAM 地址；
- `MOVX @Ri` 使用当前寄存器组 Ri 作为低八位、P2 锁存器作为高八位，即 `(P2 << 8) | Ri`；
- `MOVX` 不改变 P2 SFR 内容；
- v1 不模拟 P0/P2 引脚和外部总线波形。

### 4.10 操作码和周期

- 经典 8051 有 256 个编码位置；
- 其中 255 个是有效指令编码；
- `0xA5` 是唯一保留编码，在 v1 中返回 `IllegalOpcode`；
- 开发期间，有效但尚未实现的编码返回 `UnsupportedOpcode`，不得伪装成非法指令或 NOP；
- M4 完成时不得再存在 `UnsupportedOpcode`；
- 每个条目包含指令标识、助记符、长度和名义机器周期；
- 长度只能为 1、2 或 3 字节；
- 周期按经典 12 振荡周期架构的机器周期记录，不驱动 v1 未实现外设。

## 5. 目标模块结构

```text
src/
├── main.rs               命令行入口
├── lib.rs                公共库入口
├── error.rs              加载、寻址和执行错误
├── loader.rs             裸二进制固件加载
├── memory.rs             CODE、IRAM、SFR 和 XRAM
├── cpu.rs                CPU 状态、step 和 run
├── opcode.rs             256 项译码元数据
└── instructions/
    ├── mod.rs
    ├── data_transfer.rs
    ├── arithmetic.rs
    ├── logical.rs
    ├── bit.rs
    └── control.rs
```

模块可以随实现细节小幅调整，但存储器、CPU、译码、指令语义和 CLI 的职责边界必须保持。

## 6. 目标公开接口

以下接口用于锁定职责和返回语义；实现时可以补充派生 trait 或不改变语义的辅助方法。

### 6.1 固件加载

```rust
pub fn load_binary(path: impl AsRef<Path>) -> Result<ProgramMemory, LoadError>;

impl ProgramMemory {
    pub fn from_bytes(bytes: Vec<u8>) -> Result<Self, LoadError>;
    pub fn read(&self, address: u16) -> u8;
}
```

`LoadError` 至少区分文件读取失败和固件超过 64 KiB。

### 6.2 存储器

```rust
pub fn read_direct(&self, address: u8) -> Result<u8, AddressError>;
pub fn write_direct(&mut self, address: u8, value: u8)
    -> Result<(), AddressError>;

pub fn read_indirect(&self, address: u8) -> Result<u8, AddressError>;
pub fn write_indirect(&mut self, address: u8, value: u8)
    -> Result<(), AddressError>;

pub fn read_bit(&self, address: u8) -> Result<bool, AddressError>;
pub fn write_bit(&mut self, address: u8, value: bool)
    -> Result<(), AddressError>;

pub fn read_xram(&self, address: u16) -> u8;
pub fn write_xram(&mut self, address: u16, value: u8);

pub fn read_register(&self, index: u8) -> Result<u8, AddressError>;
pub fn write_register(&mut self, index: u8, value: u8)
    -> Result<(), AddressError>;

pub fn dptr(&self) -> u16;
pub fn set_dptr(&mut self, value: u16);
```

寄存器索引只接受 `0..=7`。

### 6.3 CPU

```rust
pub struct CpuState {
    pub pc: u16,
    pub acc: u8,
    pub b: u8,
    pub psw: u8,
    pub sp: u8,
    pub dptr: u16,
    pub steps: u64,
    pub machine_cycles: u64,
}

pub struct StepResult {
    pub pc_before: u16,
    pub pc_after: u16,
    pub bytes: [u8; 3],
    pub length: u8,
    pub mnemonic: &'static str,
    pub machine_cycles: u8,
}

pub struct RunResult {
    pub stop_reason: StopReason,
    pub steps_executed: u64,
    pub machine_cycles_executed: u64,
}

pub enum StopReason {
    StepLimitReached,
}

impl Cpu {
    pub fn new(program: ProgramMemory) -> Self;
    pub fn reset(&mut self);
    pub fn step(&mut self) -> Result<StepResult, ExecutionError>;
    pub fn run(&mut self, max_steps: u64)
        -> Result<RunResult, ExecutionError>;
    pub fn state(&self) -> CpuState;
}
```

`run(max_steps)` 最多执行本次调用允许的成功指令数；累计计数保存在 CPU 中。`max_steps == 0` 时立即返回 `StepLimitReached`，不执行指令。

### 6.4 错误和停止原因

- `LoadError`：I/O、固件过大；
- `AddressError`：无效间接 IRAM、未定义 SFR、不可位寻址 SFR、无效寄存器索引；
- `ExecutionError`：携带起始 PC、操作码和具体错误原因；
- `IllegalOpcode`：只用于 `0xA5`；
- `UnsupportedOpcode`：只允许在开发阶段出现；
- `StepLimitReached`：正常停止，不是错误。

失败指令不增加累计步数或机器周期，PC 保持在失败指令起始地址。对调用、POP 等可能多次访问存储器的指令，应预先验证全部地址，避免可诊断错误留下部分更新。

## 7. 实施阶段

测试与实现同步提交。最后的测试阶段用于补齐覆盖和集成验证，而不是首次开始编写测试。

### 阶段 1：工程基础和错误模型

- 增加 `lib.rs`，分离核心库和 CLI；
- 将 `binfile.rs` 重构为 `loader.rs`；
- 引入统一、可携带上下文的错误类型；
- 消除库代码中的 `unwrap()` 和无说明 `panic!()`；
- 替换硬编码路径；
- 建立单元测试和集成测试入口。

验收：

- 空固件、普通固件和正好 64 KiB 固件可加载；
- 超过 64 KiB 和文件不存在返回明确错误；
- 核心库不依赖工作目录或固定路径。

### 阶段 2：存储器、SFR 和复位

- 将 CODE 重构为统一 64 KiB 空间；
- 完成 IRAM、标准 SFR 和 XRAM；
- 完成直接、间接、位、寄存器组和 DPTR 访问；
- 实现标准 SFR 复位值；
- 实现 `Cpu::new()` 与 `reset()` 的不同内存语义。

验收：

- 所有地址边界和寄存器组测试通过；
- 位地址映射正确；
- 未定义和不可位寻址 SFR 返回错误；
- reset 保留 IRAM/XRAM 并恢复 SFR；
- ACC、B、PSW、SP、DPTR 没有重复存储。

### 阶段 3：译码表骨架和 CPU 执行框架

- 先建立覆盖 `0x00..=0xFF` 的完整元数据表；
- 将 `0xA5` 标记为非法，其余尚未完成项标记为未实现；
- 实现 CPU、状态快照、取指、操作数读取和 post-PC；
- 实现 NOP、`step()` 和 `run()`；
- 建立错误上下文、成功计数和统一奇偶标志更新。

验收：

- 三种指令长度和跨 `0xFFFF` 取指通过测试；
- NOP 可连续执行；
- 步数上限正常返回；
- 非法和未实现操作码可区分；
- 错误包含 PC 和操作码，失败时计数不增加。

### 阶段 4：分批实现指令

#### 4.1 基础数据和循环

- NOP；
- 字节形式 MOV，不含位、MOVC 和 MOVX；
- INC、DEC；
- CLR、SETB、CPL；
- SJMP、LJMP；
- JZ、JNZ、JC、JNC；
- DJNZ。

完成后应能运行简单清零、计数和循环程序，并具备运行 `testc51a.bin` 所需的指令类别；该固件在来源和预期结果确认前只作为烟雾样本。

#### 4.2 算术和逻辑

- ADD、ADDC、SUBB；
- MUL AB、DIV AB、DA A；
- ANL、ORL、XRL；
- RL、RLC、RR、RRC、SWAP。

每个寻址变体同步测试 CY、AC、OV、P 及边界值。

#### 4.3 控制流和栈

- AJMP；
- JMP @A+DPTR；
- CJNE；
- LCALL、ACALL；
- RET、RETI；
- PUSH、POP。

重点覆盖 2 KiB 页边界、返回地址顺序、栈无效区和 SP wrapping。

#### 4.4 位、CODE 和 XRAM

- MOV C,bit、MOV bit,C；
- ANL C,bit、ANL C,/bit；
- ORL C,bit、ORL C,/bit；
- JB、JNB、JBC；
- MOVC；
- MOVX；
- XCH、XCHD。

重点覆盖 JBC 清位、`MOVC A,@A+PC` 的 PC 基准、`MOVX @Ri` 的 P2 页地址及 XCHD 低半字节交换。

#### 4.5 完整操作码收口

- 所有 255 个有效编码均有执行语义；
- `UnsupportedOpcode` 数量归零；
- 元数据中的长度、周期和指令标识与实现一致；
- `0xA5` 保持唯一非法编码；
- 不存在未处理操作码导致的 panic。

### 阶段 5：命令行工具

目标程序名为 `c51-sim`，预期命令：

```text
c51-sim firmware.bin
c51-sim firmware.bin --pc 0x0000 --max-steps 100000
c51-sim firmware.bin --single-step
c51-sim firmware.bin --trace
```

行为：

- 固件始终装载到 CODE `0x0000`，`--pc` 只改变初始执行位置；
- 默认最多执行 1,000,000 条成功指令；
- `--single-step` 执行一条指令并打印状态，不启动交互式调试器；
- 达到步数上限属于正常停止并返回成功退出码；
- 加载、参数和执行错误返回非零退出码；
- 无参数时打印帮助；
- 跟踪输出至少包含起始 PC、原始字节、助记符、执行后 ACC/PSW/SP 和本条周期；
- 最终状态包含 PC、ACC、B、PSW、SP、DPTR、累计步数和累计周期；
- 使用 `Path`/`PathBuf`，不依赖固定路径分隔符。

### 阶段 6：集成验证和质量收口

- 补齐所有操作码变体和边界覆盖；
- 为可确认来源的固件建立集成测试；
- 完善 README、API 文档和使用示例；
- 确保格式、测试、Clippy 和发布构建全部通过；
- 记录已知硬件偏差和 v1 不支持能力。

## 8. 测试计划

### 8.1 存储器与复位

- CODE/XRAM 的 `0x0000`、`0xFFFF`；
- 固件大小 0、1、65,536 和 65,537 字节；
- IRAM 的 `0x00`、`0x7F`；
- 间接访问 `0x80` 的错误；
- 标准与未定义 SFR；
- IRAM 和所有标准可位寻址 SFR；
- 四个寄存器组；
- DPTR 高低字节一致性；
- 端口复位为 `0xFF`；
- reset 保留 IRAM/XRAM、恢复 SFR 和清零计数器。

### 8.2 译码与取指

- 对 256 个字节穷尽检查元数据；
- `0xA5` 唯一非法；
- 长度只能是 1、2、3；
- 每个有效编码拥有正确周期；
- 指令从 `0xFFFE`、`0xFFFF` 开始时操作数 wrapping；
- 失败译码不推进 PC 或计数。

### 8.3 指令语义

每个操作码寻址变体至少验证：

- 执行前状态；
- PC 和原始指令字节；
- 寄存器及内存结果；
- CY、AC、OV、P；
- SP 和栈内容；
- 本条及累计机器周期。

必须覆盖：

- `0xFF + 1`；
- 带进位加法和带借位减法；
- MUL 高字节为零及非零；
- 除数为零且 A/B 保持；
- 正、负相对跳转及 16 位回绕；
- AJMP/ACALL 的 2 KiB 页边界；
- LCALL/RET 字节顺序；
- 栈目标 `0x7F`、`0x80`、`0xFF` 和 `0x00`；
- `MOV direct,direct` 的机器码操作数字节顺序；
- POP/直接写 ACC 后的奇偶标志；
- CJNE 的无符号比较和 CY；
- JBC 成功跳转后清位；
- `MOVC A,@A+PC` 和 `MOVC A,@A+DPTR`；
- `MOVX @DPTR` 和使用不同 P2 页的 `MOVX @Ri`；
- XCHD 只交换低半字节。

### 8.4 固件集成

每个权威固件测试必须记录：

- 来源和使用条件；
- 源码或可重复构建方式；
- 装载基址和入口地址；
- 最大执行步数；
- 正常停止判据；
- 预期寄存器和关键内存；
- 若以自循环结束，稳定循环地址和进入循环前的预期状态。

当前两个样本：

| 文件 | 大小 | 状态 |
| --- | ---: | --- |
| `tests/helpfiles/testc51a.bin` | 21 字节 | 来源、构建方式和权威预期结果待确认 |
| `tests/helpfiles/testc51b.bin` | 236 字节 | 来源、构建方式和权威预期结果待确认 |

信息补全前可以将它们用于人工或烟雾检查，但不能作为证明 CPU 正确性的权威断言。

### 8.5 质量门禁

交付前以下命令全部成功：

```console
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets
cargo build --release
```

## 9. 里程碑

### M1：可取指

- 完成 CODE、CPU 状态、完整译码表骨架和 NOP；
- `step()` 能返回可诊断结果；
- 三种长度及地址回绕测试通过。

### M2：可运行简单循环

- 完成基础 MOV、INC、DEC、SJMP、LJMP、DJNZ 和基础位操作；
- 能运行简单计数、清零和自循环程序；
- 建立最小跟踪输出。

### M3：核心指令可用

- 完成算术、逻辑、条件分支、栈、调用和返回；
- 标志、寄存器组和栈边界通过测试；
- 能运行不依赖外设的普通计算固件。

### M4：经典指令集完成

- 完成位操作、MOVC、MOVX、交换指令；
- 255 个有效编码全部实现；
- `0xA5` 的非法指令诊断和完整覆盖通过。

### M5：可交付

- CLI、错误诊断、跟踪、状态输出和固件测试完成；
- 所有质量门禁通过；
- README、API 文档、语义偏差和使用示例完整。

## 10. v1 完成标准

- 安全加载不超过 64 KiB 的裸二进制固件；
- CPU 能单步和有限步数连续运行；
- 255 个有效编码均有正确元数据和语义，`0xA5` 明确非法；
- 直接、间接、位、CODE 和 XRAM 寻址通过测试；
- 寄存器组、栈、调用、返回和所有跳转通过边界测试；
- 标志行为通过每个相关寻址变体的测试；
- 标准 SFR 可访问，未定义 SFR 可诊断；
- 非法指令和非法访问不会产生无说明 panic；
- CLI 显示状态和明确停止原因；
- 步数上限不会被报告为执行错误；
- 存储器、指令和权威固件三个测试层次齐全；
- 发布构建无编译警告，格式、Clippy 和测试全部通过；
- 核心公共类型和关键语义具有 Rust 文档。

## 11. 后续扩展

在 v1 稳定后按以下方向评估：

1. Intel HEX；
2. 断点、观察点和交互式调试；
3. 定时器 0/1；
4. 中断控制器；
5. 串口；
6. GPIO 输入/输出回调和端口读语义；
7. 8052 上层 IRAM 和定时器 2；
8. 厂商特定 SFR；
9. WebAssembly 或图形调试界面；
10. 与真实 8051 或独立模拟器进行差分测试。

扩展不能静默改变 v1 的经典 8051 模式，应通过明确型号或配置选择启用。

## 12. 文档和计划维护

- 每次功能合并时更新 README 当前状态和本文件相应阶段；
- 完成项使用明确的提交或测试证据，不按主观进度标记；
- 新增 SFR、外设或硬件偏差时更新范围与语义决策；
- 指令表发生变化时同步更新覆盖测试；
- 固件样本加入回归测试前补齐来源、构建方式和预期状态；
- 若实现必须偏离本文档，先更新决策、理由和兼容性影响，再修改代码；
- 时间估算只作为排期参考，不作为降低完成标准的依据。

## 13. 主要参考资料

- [Intel MCS-51 Family of Single Chip Microcomputers User's Manual（1981）](https://www.bitsavers.org/components/intel/8051/MCS-51_Users_Manual_Jan81.pdf)
- [Intel MCS-51 Microcontroller Family User's Manual（1994）](https://www.bitsavers.org/components/intel/8051/MCS-51_Users_Manual_Feb94.pdf)
- [Intel 8051 Preliminary Architectural Specification and Functional Description（1980）](https://www.bitsavers.org/components/intel/8051/8051_Microcomputer_Preliminary_Architectural_Specification_May80.pdf)
- [Intel 8031AH/8051AH Data Sheet](https://intel-vintage-developer.eu5.org/DESIGN/MCS51/DATASHTS/27049906.PDF)

实现和测试应优先依据原始架构与指令手册；第三方指令表只能作为检索辅助，不能代替语义来源。
