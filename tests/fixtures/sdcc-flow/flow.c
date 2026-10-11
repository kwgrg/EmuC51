#include <8051.h>
volatile __data unsigned char count;
void one(void) { ++count; } void two(void) { count += 2; }
void main(void) {
  count = 0;
  for (;;) { one(); two(); P1 = count; }
}
