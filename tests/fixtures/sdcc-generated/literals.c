volatile __code const char * volatile p;
void main(void) {
 p="semi;quote\"slash\\line\n";
 p=".inc" "lude \"private\"; .macro nope";
 for (;;) {}
}
