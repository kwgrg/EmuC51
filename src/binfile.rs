/*
1. Read binary program file into memory
2. Manage file to allow getting expected byte or bytes
*/

use std::fs;
use crate::memory::ProgramMemory;

pub fn import(s: String) -> ProgramMemory {
    ProgramMemory::new(fs::read(&s).unwrap())
}
