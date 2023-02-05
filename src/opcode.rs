use crate::memory::DataMemory;

enum Opcodes {
    OneByte,
    TwoBytes,
    ThreeBytes,
}

enum Operands {
    Single (fn(u8, &mut DataMemory) -> bool),
    Double (fn(u8, u8, &mut DataMemory) -> bool),
}

pub struct Instruction {
    op_len: Opcodes,
    op_func: Operands,
}
