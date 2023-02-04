mod binfile;

fn main() {
    let A = binfile::import(String::from(".\\tests\\helpfiles\\testc51a.bin"));
    let B = binfile::import(String::from(".\\tests\\helpfiles\\testc51b.bin"));
    A.print();
    B.print();
    print(B.getn(0,3));
    print(B.getn(2,1));
}


fn print(content: Vec<u8>) {
    for c in &content {
        print!("{:#x} ", c);
    } 
    println!("\n***");
}