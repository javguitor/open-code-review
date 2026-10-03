/**
 * Command-string helpers shared by the command palette (build + prefill).
 *
 * The server splits the command with `shellSplit` (server/socket/prompt-builder.ts):
 * whitespace separates tokens, single/double quotes group, and inside double
 * quotes `\"` and `\\` are literal characters. `quoteArg` is the inverse.
 */

/** Wrap a free-text value so `shellSplit` returns it as exactly one token. */
export function quoteArg(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Undo `quoteArg`'s escaping for the inside of a double-quoted value. */
export function unescapeDoubleQuoted(value: string): string {
  return value.replace(/\\(["\\])/g, '$1')
}

/**
 * Pull every `--<flag> <value>` out of `raw` (value is a double-quoted string,
 * a single-quoted string, or a bare token), returning the remaining string and
 * the decoded values in order.
 */
export function extractQuotedFlag(
  raw: string,
  flag: string,
): { cleaned: string; values: string[] } {
  const values: string[] = []
  const re = new RegExp(`--${flag}\\s+(?:"((?:[^"\\\\]|\\\\.)*)"|'([^']*)'|(\\S+))`, 'g')
  const cleaned = raw.replace(re, (_m, dq, sq, bare) => {
    values.push(dq !== undefined ? unescapeDoubleQuoted(dq) : (sq ?? bare ?? ''))
    return ''
  })
  return { cleaned: cleaned.replace(/\s{2,}/g, ' ').trim(), values }
}

/**
 * `--with-comments --requirements "<text>"` args, or none when the text is empty.
 * The value is quoted because the server's `shellSplit` takes exactly one token
 * after `--requirements`; unquoted multi-word text would spill into the target.
 */
export function requirementsArgs(requirements: unknown, withComments: boolean): string[] {
  if (typeof requirements !== 'string' || !requirements.trim()) return []
  return [...(withComments ? ['--with-comments'] : []), '--requirements', quoteArg(requirements.trim())]
}
