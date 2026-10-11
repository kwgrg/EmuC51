#include "shared.h"
volatile __data unsigned char shared;
volatile __data unsigned int word_result;
static volatile __data unsigned char shadow;
void main(void) {
 shadow=7;
 shared=compute(
   5);
 word_result=asm_word(0x12ff);
 for (;;) { shadow=shared; }
}
