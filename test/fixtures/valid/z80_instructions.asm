; Valid Z80 Instructions Fixture

label1:
    nop
    ld a, b
    ld b, c
    ld h, d
    ld l, e
    ld (hl), a
    ld a, (bc)
    ld a, (de)
    ld (bc), a
    ld (de), a
    ld bc, 1234h
    ld de, 5678h
    ld hl, 9abch
    ld sp, hl
    ld ix, 1111h
    ld iy, 2222h
    ld (ix+5), a
    ld a, (iy-3)
    
    add a, b
    adc a, c
    sub d
    sbc a, e
    and h
    or l
    xor (hl)
    cp 255
    
    inc a
    dec b
    inc bc
    dec de
    
    rlca
    rrca
    rla
    rra
    
    rlc a
    rrc b
    rl c
    rr d
    sla e
    sra h
    srl l
    
    bit 0, a
    set 1, b
    res 2, c
    
    jp label1
    jp nz, label1
    jp z, label1
    jp c, label1
    jp nc, label1
    
    jr label1
    jr nz, label1
    
    call label1
    call z, label1
    
    ret
    ret c
    reti
    retn
    
    push bc
    push de
    push hl
    push af
    push ix
    push iy
    
    pop af
    pop hl
    pop de
    pop bc
    
    in a, (c)
    in a, (255)
    out (c), a
    out (255), a
    
    ex af, af'
    ex de, hl
    ex (sp), hl
    
    halt
    di
    ei
