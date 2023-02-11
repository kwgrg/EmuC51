// Constants of Program Memory for MCS51. Unit: byte
const INTERNAL_PROG_MEM_SIZE: usize = 4 * 1024;
const EXTERNAL_PROG_MEM_SIZE: usize = 64 * 1024 - INTERNAL_PROG_MEM_SIZE;


pub struct ProgramMemory { 
    //
    // program memory = internal + external
    //

    internal: Vec<u8>, // internal program memory
    external: Vec<u8>, // external program memory
}

impl ProgramMemory {

    // new object for program memory with input content
    pub fn new(content: Vec<u8>) -> Self {
        // initialize program memory with 0
        let mut obj = ProgramMemory { 
            internal: vec![0;INTERNAL_PROG_MEM_SIZE], 
            external: vec![0;EXTERNAL_PROG_MEM_SIZE], 
        };

        // write content into program memory
        for i in 0..content.len() {
            if i < INTERNAL_PROG_MEM_SIZE { // write content into internal first
                obj.internal[i] = content[i];
            }else if i < (INTERNAL_PROG_MEM_SIZE + EXTERNAL_PROG_MEM_SIZE) { // write rest content into external
                obj.external[i - INTERNAL_PROG_MEM_SIZE] = content[i];
            }else{ // out of range
                panic!("no enough program memory for input content!");
            }
        }

        obj
    }

    // get n bytes from specific address in program memory
    pub fn getn(&self, pos: usize, len: usize) -> Vec<u8> {
        let mut obj = Vec::with_capacity(len);

        for i in 0..len {
            if (pos + i) < INTERNAL_PROG_MEM_SIZE { // found in internal memory
                obj.push(self.internal[pos + i]);
            }else if (pos + i) < (INTERNAL_PROG_MEM_SIZE + EXTERNAL_PROG_MEM_SIZE) { // found in external
                obj.push(self.external[pos + i - self.internal.len()]);
            }else{ // out of range
                panic!("{} is out of program range (0~{})", pos + i, INTERNAL_PROG_MEM_SIZE + EXTERNAL_PROG_MEM_SIZE - 1);
            }
        }

        obj
    }

}


// Constants of Data Memory for MCS51. Unit of SIZE: byte
const ON_CHIP_DATA_MEM_START: usize = 0x0;
const ON_CHIP_DATA_MEM_SIZE: usize = 128;

const SPEC_FUNC_REG_DATA_MEM_START: usize = 0x80;
const SPEC_FUNC_REG_DATA_MEM_SIZE: usize = 128;

const RIGISTER_BANK_N_START: [usize; 4] = [0x0, 0x8, 0x10, 0x18];
const RIGISTER_BANK_N_SIZE: usize = 8;
const RIGISTER_BANK_SIZE: usize = RIGISTER_BANK_N_SIZE * RIGISTER_BANK_N_START.len();

const BIT_AREA_ADDRESSING_START: usize = 0x0;
const BIT_AREA_ADDRESSING_SIZE: usize = 128;
const BIT_AREA_REAL_START: usize = 0x20;
const BIT_AREA_REAL_SIZE: usize = 16;
const BIT_MASK_N: [usize; 8] = [1 << 0, 1 << 1, 1 << 2, 1 << 3, 1 << 4, 1 << 5, 1 << 6, 1 << 7];

const EXTERNAL_DATA_MEM_START: usize = 0x0;
const EXTERNAL_DATA_MEM_SIZE: usize = 64 * 1024;


#[derive(Debug)]
enum DataMemoryType {
    OnChipRam,   // on-chip RAM
    SpecFuncReg, // special function registers
    ExternalRam, // external RAM
}

pub enum AddressingMode {
    Indirect, // indirect addressing
    Direct,   // direct addressing
    Bit,      // bit addressing
    External, // external address
}

pub struct DataMemory { 
    //
    // on_chip ram/special func registers/external ram are 
    // independent and accessible with different modes.
    //
    
    on_chip: Vec<u8>,       // on-chip RAM
    spec_func_reg: Vec<u8>, // special function registers
    external: Vec<u8>,      // external RAM
}

impl DataMemory {

    // new object for data memory   
    pub fn new() -> Self {
        // initialize data memory with 0
        DataMemory { 
            on_chip: vec![0;ON_CHIP_DATA_MEM_SIZE], 
            spec_func_reg: vec![0;SPEC_FUNC_REG_DATA_MEM_SIZE], 
            external: vec![0;EXTERNAL_DATA_MEM_SIZE],
        }
    }

    // [base func for internal use]
    // get n bytes from specific address in certain type of data memory
    fn getn(&self, mtype: DataMemoryType, pos: usize, len: usize) -> Vec<u8> {
        let mut obj = Vec::with_capacity(len);

        // switch to expected data memory according to type
        let mem = match mtype { 
            DataMemoryType::OnChipRam => &self.on_chip,
            DataMemoryType::SpecFuncReg => &self.spec_func_reg,
            DataMemoryType::ExternalRam => &self.external,
        };

        for i in 0..mem.len() {
            if (pos + i) < mem.len() { // found in data memory
                obj.push(mem[pos + i]);
            }else{ // out of range
                panic!("{} is out of data memory ({:?}) range (0~{})", pos + i, mtype, mem.len());
            }
        }

        obj
    }

}