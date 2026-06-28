; Valid eZ80 Instructions Fixture

ez80_label1:
    lea hl, ix+5
    lea bc, iy+10
    lea de, ix-2
    pea ix+5
    pea iy-10
    
    ld.lil bc, 123456h
    ld.lis bc, 1234h
    ld.s hl, (123456h)
    ld.l hl, (123456h)
    
    add.s hl, bc
    add.l hl, de
    
    in0 a, (255)
    out0 (255), a
    
    slp
    stmix
    rsmix
