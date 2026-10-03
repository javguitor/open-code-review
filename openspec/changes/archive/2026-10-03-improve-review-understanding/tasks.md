## 1. Overview in the internal review
- [x] 1.1 `final-template.md`: `## What This Change Does` section and synthesis step; `workflow.md` pointer
- [x] 1.2 Language policy: add the heading to `language-policy.md` and `LANGUAGE_POLICY_TEMPLATE` (drift test keeps them in sync)
- [x] 1.3 `translate-review-to-single-human.md`: section and diagrams are never carried into the posted review
- [x] 1.4 Test that `parseFinalMd` is unaffected by the new section

## 2. Dashboard diagrams
- [x] 2.1 Move `mermaid-renderer` to `components/markdown/` with a `securityLevel` prop (map keeps `'loose'`)
- [x] 2.2 `MarkdownRenderer` renders ```mermaid blocks lazily with `'strict'`; error shows source
- [x] 2.3 Tests for the markdown renderer's mermaid path

## 3. Posted state
- [x] 3.1 Migration 20 (`posted_at`, `posted_url`, `posted_state`) and `markRoundPosted`, with tests
- [x] 3.2 `post-handler` records the post and emits `session:updated`; recording failure does not fail the post
- [x] 3.3 Sessions and reviews APIs expose posted fields; `api-types.ts`

## 4. List freshness and UI
- [x] 4.1 Session list/detail queries use `refetchOnWindowFocus: true`
- [x] 4.2 Successful post invalidates the sessions and reviews queries
- [x] 4.3 "Posted" badge on session card, session detail and reviews list
- [x] 4.4 "Not posted" filter on the sessions page
- [x] 4.5 i18n en + es
