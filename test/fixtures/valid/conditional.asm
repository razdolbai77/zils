; Conditional assembly: if/else/endif, ifdef, ifndef (eZ80)
FLAG: equ 1
 if FLAG
  nop
 else
  nop
 endif
 ifdef FLAG
  nop
 endif
 ifndef NOSUCH
  nop
 endif
