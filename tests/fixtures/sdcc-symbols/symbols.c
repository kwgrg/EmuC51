/* Classic 8051 static storage fixture; no header-derived aliases. */
volatile __data unsigned char ACC;
volatile __data unsigned int count16;
static volatile __data unsigned char shadow;
volatile __idata unsigned char indirect_byte;
volatile __xdata __at (0x1234) unsigned long wide;
__code unsigned char rom_bytes[3] = {0x12, 0x34, 0x56};
__sfr __at (0x90) port_out;
__sfr __at (0x99) serial_latch;
volatile __bit flag;
__idata __at (0x80) unsigned char outside_classic;
unsigned char *pointer_value;
struct Pair { unsigned char first; unsigned int second; } pair_value;
static unsigned char optimized_unused;
extern unsigned char missing_external;
void set_values(void) {
  static volatile unsigned char shadow;
  shadow = 0x31;
  ACC = shadow;
  count16 = 0x1234;
  indirect_byte = 0x56;
  wide = 0x12345678UL;
  port_out = 0xa5;
  serial_latch = 0x41;
}
void main(void) {
  shadow = 0x22;
  set_values();
  while (1) { }
}
