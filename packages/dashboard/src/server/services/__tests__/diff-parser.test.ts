import { describe, it, expect } from 'vitest'
import { parseUnifiedDiff } from '../diff-parser.js'

const MODIFIED = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,5 @@ function foo() {
 line1
-line2
+line2 changed
+line2b
 line3
 line4
@@ -20,2 +21,2 @@
 keep
-old
+new
`

describe('parseUnifiedDiff', () => {
  it('returns no files for an empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual({ files: [] })
    expect(parseUnifiedDiff('\n')).toEqual({ files: [] })
  })

  it('parses hunks with old/new line numbers', () => {
    const { files } = parseUnifiedDiff(MODIFIED)
    expect(files).toHaveLength(1)
    const f = files[0]!
    expect(f).toMatchObject({ oldPath: 'src/a.ts', newPath: 'src/a.ts', status: 'modified', additions: 3, deletions: 2 })
    expect(f.hunks).toHaveLength(2)
    const h = f.hunks[0]!
    expect(h).toMatchObject({ oldStart: 1, oldLines: 4, newStart: 1, newLines: 5, header: 'function foo() {' })
    expect(h.lines.map((l) => [l.type, l.oldNo, l.newNo, l.text])).toEqual([
      ['ctx', 1, 1, 'line1'],
      ['del', 2, null, 'line2'],
      ['add', null, 2, 'line2 changed'],
      ['add', null, 3, 'line2b'],
      ['ctx', 3, 4, 'line3'],
      ['ctx', 4, 5, 'line4'],
    ])
    expect(f.hunks[1]!.lines[1]).toEqual({ type: 'del', oldNo: 21, newNo: null, text: 'old' })
  })

  it('defaults a missing hunk count to 1', () => {
    const { files } = parseUnifiedDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -3 +3 @@\n-a\n+b\n')
    expect(files[0]!.hunks[0]).toMatchObject({ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1 })
    expect(files[0]!.hunks[0]!.lines).toHaveLength(2)
  })

  it('detects added and deleted files', () => {
    const { files } = parseUnifiedDiff(
      `diff --git a/new.ts b/new.ts
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+one
+two
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
index e69de29..0000000
--- a/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-bye
`,
    )
    expect(files.map((f) => [f.status, f.oldPath, f.newPath])).toEqual([
      ['added', null, 'new.ts'],
      ['deleted', 'gone.ts', null],
    ])
    expect(files[0]!.hunks[0]!.lines.map((l) => l.newNo)).toEqual([1, 2])
    expect(files[1]!.newMode).toBeUndefined()
    expect(files[1]!.oldMode).toBe('100644')
  })

  it('parses a pure rename and a rename with edits', () => {
    const { files } = parseUnifiedDiff(
      `diff --git a/old name.ts b/new name.ts
similarity index 100%
rename from old name.ts
rename to new name.ts
diff --git a/b.ts b/c.ts
similarity index 80%
rename from b.ts
rename to c.ts
index 1..2 100644
--- a/b.ts
+++ b/c.ts
@@ -1 +1 @@
-x
+y
`,
    )
    expect(files[0]).toMatchObject({ status: 'renamed', oldPath: 'old name.ts', newPath: 'new name.ts', hunks: [] })
    expect(files[1]).toMatchObject({ status: 'renamed', oldPath: 'b.ts', newPath: 'c.ts', additions: 1, deletions: 1 })
  })

  it('marks binary files', () => {
    const { files } = parseUnifiedDiff(
      'diff --git a/img.png b/img.png\nindex 1..2 100644\nBinary files a/img.png and b/img.png differ\n',
    )
    expect(files[0]).toMatchObject({ status: 'binary', oldPath: 'img.png', newPath: 'img.png', hunks: [] })
  })

  it('reports a mode-only change without hunks', () => {
    const { files } = parseUnifiedDiff('diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n')
    expect(files[0]).toMatchObject({ status: 'modified', oldMode: '100644', newMode: '100755', hunks: [] })
  })

  it('flags lines followed by "\\ No newline at end of file"', () => {
    const { files } = parseUnifiedDiff(
      `diff --git a/f b/f
--- a/f
+++ b/f
@@ -1,2 +1,2 @@
 keep
-last
\\ No newline at end of file
+last!
\\ No newline at end of file
`,
    )
    const lines = files[0]!.hunks[0]!.lines
    expect(lines).toHaveLength(3)
    expect(lines[1]).toMatchObject({ type: 'del', noNewline: true })
    expect(lines[2]).toMatchObject({ type: 'add', noNewline: true })
    expect(lines[0]!.noNewline).toBeUndefined()
  })

  it('does not mistake body lines that look like headers', () => {
    const { files } = parseUnifiedDiff(
      `diff --git a/f b/f
--- a/f
+++ b/f
@@ -1,2 +1,2 @@
--- a flag line removed
+++ a flag line added
 same
`,
    )
    expect(files).toHaveLength(1)
    expect(files[0]!.hunks[0]!.lines.map((l) => [l.type, l.text])).toEqual([
      ['del', '-- a flag line removed'],
      ['add', '++ a flag line added'],
      ['ctx', 'same'],
    ])
  })

  it('strips quotes git adds around unusual paths', () => {
    const { files } = parseUnifiedDiff('diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"\n--- "a/x.ts"\n+++ "b/x.ts"\n')
    expect(files[0]!.newPath).toBe('x.ts')
  })
})
