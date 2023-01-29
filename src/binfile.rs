/*
1. Read binary program file into memory
2. Manage file to allow getting expected byte or bytes
*/

use std::fs;

pub struct Program {
    content: Vec<u8>,
}

impl Program {
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

fn print(s: String) {
    let content = fs::read(&s).unwrap();
    println!("{}", &s);
    for c in &content {
        print!("{:#x} ", c);
    } 
    println!("\n***");
}