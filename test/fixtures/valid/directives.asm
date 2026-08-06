; Structural directives: org, relocate/endrelocate (eZ80)
  org 0x100
start:
  relocate
  nop
  endrelocate
  ret
