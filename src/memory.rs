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

const ON_CHIP_BIT_AREA_ADDRESSING_START: usize = 0x0;
const ON_CHIP_BIT_AREA_ADDRESSING_SIZE: usize = 128;
const ON_CHIP_BIT_AREA_REAL_START: usize = 0x20;

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
    // get byte from specific address in certain type of data memory
    fn get_byte(&self, mtype: DataMemoryType, pos: usize) -> u8 {
        let mut ret: u8;

        // switch to expected data memory according to type
        let mem = match mtype { 
            DataMemoryType::OnChipRam => &self.on_chip,
            DataMemoryType::SpecFuncReg => &self.spec_func_reg,
            DataMemoryType::ExternalRam => &self.external,
        };

        let real_pos = match mtype { // SFRs start from SPEC_FUNC_REG_DATA_MEM_START
            DataMemoryType::SpecFuncReg => pos - SPEC_FUNC_REG_DATA_MEM_START,
            _ => pos,
        };

        if real_pos < mem.len() {
            ret = mem[real_pos];
        }else{ // out of range
            panic!("{} is out of data memory ({:?}) range (0~{})", real_pos, mtype, mem.len());
        }

        ret
    }

    fn get_byte_with_bit_addressing(&self, pos: usize) -> u8 {
        let mut ret: u8;

        if pos < ON_CHIP_BIT_AREA_ADDRESSING_START + ON_CHIP_BIT_AREA_ADDRESSING_SIZE {
            // 0~0x7F mapped to 0x20.0~0x2F.7
            let primary = pos / 8 + ON_CHIP_BIT_AREA_REAL_START;
            let offset = pos % 8;
            ret = self.get_byte(DataMemoryType::OnChipRam, primary) & (1 << offset);
        }else if pos < SPEC_FUNC_REG_DATA_MEM_START + SPEC_FUNC_REG_DATA_MEM_SIZE {
            // 0x80~0x8F mapped to 0x80.0~0x80.7 for every 8 address in 0x80~0xFF
            let primary = (pos >> 3) << 3;
            let offset = pos % 8;
            ret = self.get_byte(DataMemoryType::SpecFuncReg, primary) & (1 << offset);
        }else{ // out of range
            panic!("{} is out of bit addressing area", pos);
        }

        ret
    }

    fn get_byte_with_direct_addressing(&self, pos: usize) -> u8 {
        let mut ret: u8;

        if pos < ON_CHIP_DATA_MEM_START + ON_CHIP_DATA_MEM_SIZE {
            ret = self.get_byte(DataMemoryType::OnChipRam, pos);
        }else if pos < SPEC_FUNC_REG_DATA_MEM_START + SPEC_FUNC_REG_DATA_MEM_SIZE {
            ret = self.get_byte(DataMemoryType::SpecFuncReg, pos);
        }else{ // out of range
            panic!("{} is out of direct addressing area", pos);
        }

        ret
    }

    fn get_byte_with_indirect_addressing(&self, pos: usize) -> u8 {
        let mut ret: u8;

        if pos < ON_CHIP_DATA_MEM_START + ON_CHIP_DATA_MEM_SIZE {
            ret = self.get_byte(DataMemoryType::OnChipRam, pos);
        }else{ // out of range
            panic!("{} is out of indirect addressing area", pos);
        }

        ret
    }

    fn get_byte_with_external_addressing(&self, pos: usize) -> u8 {
        let mut ret: u8;

        if pos < EXTERNAL_DATA_MEM_START + EXTERNAL_DATA_MEM_SIZE {
            ret = self.get_byte(DataMemoryType::ExternalRam, pos);
        }else{ // out of range
            panic!("{} is out of external addressing area", pos);
        }

        ret
    }

}