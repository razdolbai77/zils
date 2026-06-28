; Invalid eZ80 Instructions Fixture

    lea a, ix+5      ; LEA destination must be 16/24-bit register (HL, BC, DE, IX, IY)
    pea a            ; PEA takes index+offset
    ld.xyz bc, 1234h ; invalid suffix
    in0 b, (c)       ; in0 uses immediate port addressing
    out0 (c), b      ; out0 uses immediate port addressing
