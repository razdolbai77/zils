; Invalid Z80 Instructions Fixture

    ld a, bc    ; size mismatch
    ld hl, c    ; size mismatch
    ld (bc), hl ; invalid addressing
    add hl, a   ; invalid operands
    jr zc, label1 ; invalid condition
    ret nzq      ; invalid condition
    push a      ; must push 16-bit register
    pop a       ; must pop 16-bit register
    in b, (255) ; 8-bit port in can only target a
    out (255), b ; 8-bit port out can only source a
    bit 8, a    ; bit must be 0-7
    set 9, b    ; bit must be 0-7
