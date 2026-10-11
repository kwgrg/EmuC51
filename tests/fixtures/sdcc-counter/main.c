#include <8051.h>
volatile __data unsigned char counter;
void main(void) {
  counter = 0;
  for (;;) {
    ++counter;
    P1 = counter;
  }
}
