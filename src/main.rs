use memory::DataMemory;

mod binfile;
mod opcode;
mod memory;

fn main() {
    let a = binfile::import(String::from(".\\tests\\helpfiles\\testc51a.bin"));
    let b = binfile::import(String::from(".\\tests\\helpfiles\\testc51b.bin"));
    print(a.getn(0, 100));
    print(b.getn(0,236));
    print(b.getn(126,10));
}


fn print(content: Vec<u8>) {
    for c in &content {
        print!("{:#x} ", c);
    } 
    println!("\n***");
}