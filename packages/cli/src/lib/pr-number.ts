/** Strict positive-integer PR number: rejects `0`, `1e1`, `0x2`, `+3`, ` 4`. */
export function isValidPrNumber(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value);
}
