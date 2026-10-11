.module bridge
.globl _asm_add
.globl _shared
.globl _finish
.globl _asm_word
.area CSEG (CODE)
_asm_add:
 mov a,dpl
 add a,#2
 mov _shared,a
 mov dpl,a
 lcall _finish
 ret

_asm_word:
 mov a,dpl
 add a,#1
 mov dpl,a
 mov a,dph
 addc a,#0
 mov dph,a
 ret

; CODE data is not a source breakpoint, even when bytes resemble opcodes.
.db 0x00,0x22
