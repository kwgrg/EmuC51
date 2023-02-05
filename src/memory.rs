// Constans for MCS51. Unit: byte
const INTERNAL_PROG_MEM_SIZE: usize = 4 * 1024;
const EXTERNAL_PROG_MEM_SIZE: usize = 64 * 1024 - INTERNAL_PROG_MEM_SIZE;
const ON_CHIP_DATA_MEM_SIZE: usize = 128;
const SPEC_FUNC_REG_DATA_MEM_SIZE: usize = 128;
const EXTERNAL_DATA_MEM_SIZE: usize = 64 * 1024;

pub struct ProgramMemory {
    // internal program memory
    internal: Vec<u8>,

    // external program memory
    external: Vec<u8>,
}

impl ProgramMemory {
    pub fn new(content: Vec<u8>) -> Self {
        let mut obj = ProgramMemory { 
            internal: vec![0;INTERNAL_PROG_MEM_SIZE], 
            external: vec![0;EXTERNAL_PROG_MEM_SIZE] 
        };
        for i in 0..content.len() {
            if i < INTERNAL_PROG_MEM_SIZE {
                obj.internal[i] = content[i];
            }else if i < (INTERNAL_PROG_MEM_SIZE + EXTERNAL_PROG_MEM_SIZE) {
                obj.external[i - INTERNAL_PROG_MEM_SIZE] = content[i];
            }else{
                panic!("no enough program memory for input content!");
            }
        }

        obj
    }

    pub fn getn(&self, pos: usize, len: usize) -> Vec<u8> {
        let mut obj = Vec::with_capacity(len);
        for i in 0..len {
            if (pos + i) < INTERNAL_PROG_MEM_SIZE {
                obj.push(self.internal[pos + i]);
            }else if (pos + i) < (INTERNAL_PROG_MEM_SIZE + EXTERNAL_PROG_MEM_SIZE) {
                obj.push(self.external[pos + i - self.internal.len()]);
            }else{
                panic!("{} is out of program range (0~{})", pos + i, INTERNAL_PROG_MEM_SIZE + EXTERNAL_PROG_MEM_SIZE - 1);
            }
        }

        obj
    }
}

pub struct DataMemory {
    // on-chip RAM
    on_chip: Vec<u8>,

    // Special Function Registers
    spec_func_reg: Vec<u8>,
    
    // external RAM
    external: Vec<u8>,
}

impl DataMemory {
    pub fn new() -> Self {
        DataMemory { 
            on_chip: vec![0;ON_CHIP_DATA_MEM_SIZE], 
            spec_func_reg: vec![0;SPEC_FUNC_REG_DATA_MEM_SIZE], 
            external: vec![0;EXTERNAL_DATA_MEM_SIZE]
        }
    }
}