mod binfile;

fn main() {
    let A = binfile::import(String::from(".\\tests\\helpfiles\\testc51a.bin"));
    let B = binfile::import(String::from(".\\tests\\helpfiles\\testc51b.bin"));
    A.print();
    B.print();
}
