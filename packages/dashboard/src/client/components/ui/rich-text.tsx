import { Fragment } from 'react'

type RichTextProps = {
  /** Translated text; `backtick` spans render as `<code>` so literals (flags, paths) stay out of the dictionary prose. */
  text: string
  codeClassName?: string
}

export function RichText({ text, codeClassName }: RichTextProps) {
  return (
    <>
      {text.split(/`([^`]+)`/).map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className={codeClassName}>{part}</code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}
