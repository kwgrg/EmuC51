#include "shared.h"
static volatile __data unsigned char shadow;
unsigned char finish(unsigned char value) {
 shadow=3;
 return value+shadow;
}
unsigned char compute(unsigned char value) {
 return asm_add(value);
}
