# Zaets Signatures' Help

When hovering over instructions or directives in Zaets, you will see a signature format describing the instruction's operands. These signatures follow the standard notation defined by Zilog.

## Instruction Notation Summary (Table 4 from Z80 CPU User Manual)

These symbols are used to identify operands such as registers, condition codes, and numerical values:

| Symbol | Meaning |
| :--- | :--- |
| **`b`** | A single bit number (0 to 7) |
| **`cc`** | Condition Code (e.g., `NZ`, `Z`, `NC`, `C`, `PO`, `PE`, `P`, `M`) |
| **`d`** | 8-bit displacement value (signed byte) |
| **`e`** | 8-bit relative displacement value |
| **`m`** | Identifies any of `r`, `(HL)`, `(IX+d)` or `(IY+d)` |
| **`n`** | Any 8-bit value (literal) |
| **`nn`** | Any 16-bit value (literal) |
| **`p`** | A restart vector (00h, 08h, 10h, 18h, 20h, 28h, 30h, 38h) |
| **`pp`** | Register pair `BC`, `DE`, `IX`, or `SP` |
| **`qq`** | Register pair `BC`, `DE`, `HL`, or `AF` |
| **`r`** | Any 8-bit register (`A`, `B`, `C`, `D`, `E`, `H`, `L`) |
| **`r/n`** | Any 8-bit register or an 8-bit literal (shorthand extension for this system) |
| **`rr`** | Register pair `BC`, `DE`, `IY`, or `SP` |
| **`s`** | Identifies any of `r`, `n`, `(HL)`, `(IX+d)` or `(IY+d)` |
| **`ss`** | Register pair `BC`, `DE`, `HL`, or `SP` |

*Source: Z80 CPU User Manual (UM0080), Table 4.*
