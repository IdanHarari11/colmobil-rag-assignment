# Generative UI in the upstream HomeDemo (not wired yet)

Upstream file: `apps/docs/components/pages/home/demo/generative-ui.tsx`  
Source commit: `9845a8ba8a3c736bc200277ec00acc2d7b3b3ada`

## How the docs site connects it

1. `toSpecCatalog(styledGenerativeUILibrary)` builds a **component catalog** (charts, tabs, tables, figures…).
2. `createSpecToolkit(catalog, { components, placeholder })` exposes a toolkit that the model can call, notably via `render_spec`.
3. `createWidgetToolkit({ spec })` wraps that into an assistant-ui toolkit.
4. `DocsRuntimeProvider` receives `toolkit={generativeUI.toolkit}`.
5. `GenerativeUIInstructions` injects system instructions (`useAssistantInstructions` / `useWidgetInstructions`) telling the model when to call `render_spec`, `show_widget`, `present`, `search_images`, etc.
6. While a spec streams, a shimmer placeholder (`Building…`) is shown; then catalog components render the structured UI.

## How we will connect this later for RAG sources

- Do **not** let a free-form model invent UI in Stage 1–5.
- When the RAG core returns `{ answer, sources }`, map `sources` to assistant-ui **source message parts** (or a structured data part) and render them with `Sources` in `messages.tsx` / `sources.tsx`.
- Optionally, later: emit a constrained `render_spec` (or a custom data part) for tables that already exist in retrieved chunks — only after Evaluation shows value.
- Keep toolkit registration on the **Runtime provider**, not inside the visual shell, so UI and server stay separable.

This project currently ships **no** `generative-frame` dependency and does not call `render_spec`.
