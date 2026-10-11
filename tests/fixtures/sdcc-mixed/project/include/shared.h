#ifndef SHARED_H
#define SHARED_H
extern volatile __data unsigned char shared;
unsigned char asm_add(unsigned char value);
unsigned int asm_word(unsigned int value);
unsigned char finish(unsigned char value);
unsigned char compute(unsigned char value);
#endif
