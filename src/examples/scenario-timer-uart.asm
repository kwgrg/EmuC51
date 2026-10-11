; Deterministic digital input example: Timer 0, INT0, UART mode 1 echo.
; P3.2 falling at requested cycle 40; UART RX A at 80, B at 900.
ORG 0
    LJMP START
ORG 3
    INC 30h
    MOV 31h,TL0
    RETI
ORG 23h
    JNB 98h,TX_DONE
    MOV 32h,SBUF
    INC 33h
    CLR 98h
    MOV SBUF,32h
TX_DONE:
    CLR 99h
    RETI
ORG 40h
START:
    MOV TMOD,#21h
    MOV TH1,#0FFh
    MOV TL1,#0FFh
    MOV SCON,#50h
    SETB 88h
    MOV IE,#91h
    SETB 8Ch
    SETB 8Eh
LOOP:
    SJMP LOOP
END
