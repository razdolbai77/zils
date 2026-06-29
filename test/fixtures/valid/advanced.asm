global_label:
.local_label:
    ld a, 10
    call other_func
    include "somefile.asm"

other_func:
    equ_val equ 10h
    ld b, equ_val
    ret