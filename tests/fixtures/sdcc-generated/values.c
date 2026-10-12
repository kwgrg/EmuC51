volatile __code const char * volatile p;
__code const unsigned int words[] = {0x1234, 0xabcd};
__code const float fractions[] = {1.25, -2.5};
__code const unsigned char * const addresses[] = {(const unsigned char *)words, (const unsigned char *)fractions};
volatile unsigned int value;
void main(void) { p="hello"; value=words[1]; for (;;) {} }
