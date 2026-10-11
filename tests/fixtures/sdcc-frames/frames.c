#include <8051.h>
volatile __data unsigned char count;
static void leaf(void) { ++count; }
void nested(void) { leaf(); ++count; }
void recursive(unsigned char depth) __reentrant {
  if (depth) recursive(depth - 1);
  ++count;
}
void timer(void) __interrupt(1) { ++count; }
void main(void) {
  count = 0;
  for (;;) { nested(); recursive(2); }
}
