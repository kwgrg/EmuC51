; Labels belong to CODE. Constants and register names are not labels.
VALUE EQU 42h
ORG 0
ENTRY:
ALIAS: MOV A,#VALUE
LOOP: SJMP LOOP
TABLE: DB 1,2
ORG 1
OPERAND:
ORG 100h
HOLE:
END
