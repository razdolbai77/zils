; Basic Z80 instructions
    ORG 0100h
start:
    LD A, 05h
    LD B, A
    ADD A, B
    JP NZ, start
    RET
