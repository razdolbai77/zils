; Invalid Z80 instructions
    LD A, B, C   ; Too many operands
    FAKE_INSTR A ; Unknown instruction
    LD A, 256    ; Value out of range
