pub struct ProgramMemory {
    // internal program memory
    internal: Vec<u8>,

    // external program memory
    external: Vec<u8>,
}

impl ProgramMemory {
    pub fn new(content: Vec<u8>) -> Self {
        const INTERNAL_PROG_MEM: usize = 4 * 1024; // bytes
        const EXTERNAL_PROG_MEM: usize = 64 * 1024 - INTERNAL_PROG_MEM; // bytes

        let mut obj = ProgramMemory { 
            internal: Vec::with_capacity(INTERNAL_PROG_MEM), 
            external: Vec::with_capacity(EXTERNAL_PROG_MEM) 
        };
        for i in 0..content.len() {
            if i < INTERNAL_PROG_MEM {
                obj.internal.push(content[i]);
            }else if i < (INTERNAL_PROG_MEM + EXTERNAL_PROG_MEM) {
                obj.external.push(content[i]);
            }else{
                // wrong!
            }
        }

        obj
    }

    pub fn getn(&self, pos: usize, len: usize) -> Vec<u8> {
        let mut obj = Vec::with_capacity(len);
        for i in 0..len {
            if (pos + i) < self.internal.len() {
                obj.push(self.internal[pos + i]);
            }else if (pos + i) < (self.internal.len() + self.external.len()) {
                obj.push(self.external[pos + i - self.internal.len()]);
            }else{
                // wrong!
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

}