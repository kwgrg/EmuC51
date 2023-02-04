/*
1. Read binary program file into memory
2. Manage file to allow getting expected byte or bytes
*/

use std::fs;

pub struct Program {
    content: Vec<u8>,
}

impl Program {
    pub fn getn(&self, pos: usize, len: usize) -> Vec<u8> {
        let mut ret = Vec::new();
        for i in 0..len {
            ret.push(self.content[pos+i]);
        }
        ret
    }

    pub fn print(&self) {
        for c in &self.content {
            print!("{:#x} ", c);
        } 
        println!("\n***");
    }
}

pub fn import(s: String) -> Program {
    let mut p = Program { content: fs::read(&s).unwrap() };
    p
}
