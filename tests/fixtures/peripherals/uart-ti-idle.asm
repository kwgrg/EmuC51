; Classic 8051, 12 clocks per machine cycle. No Timer 2 or device extensions.
; Timer 1 mode 2 overflows each cycle; UART mode 1 therefore uses 32 cycles/bit.
; Timer 0 measures the first serial ISR entry, and UART TX wakes idle.
TI_BIT EQU 99h
TR0_BIT EQU 8Ch
TR1_BIT EQU 8Eh
ORG 0
    LJMP START
ORG 23h
    MOV 30h,TL0
    CLR TI_BIT
    INC 31h
    RETI
ORG 40h
START:
    MOV TMOD,#21h
    MOV TH1,#0FFh
    MOV TL1,#0FFh
    MOV SCON,#40h
    MOV IE,#90h
    MOV TL0,#0
    MOV TH0,#0
    SETB TR1_BIT
    SETB TR0_BIT
    MOV SBUF,#41h
    ORL PCON,#1
    MOV 32h,#55h
DONE:
    SJMP DONE
END
