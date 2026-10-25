# Third-party UI attribution

## assistant-ui HomeDemo

Visual composition and chat shell adapted from the assistant-ui documentation homepage demo.

- Repository: https://github.com/assistant-ui/assistant-ui
- Path: `apps/docs/components/pages/home/demo`
- Source commit: `9845a8ba8a3c736bc200277ec00acc2d7b3b3ada`
  (https://github.com/assistant-ui/assistant-ui/commit/9845a8ba8a3c736bc200277ec00acc2d7b3b3ada)
- License: MIT — full text in `docs/licenses/assistant-ui-MIT.txt`
- Copyright: AgentbaseAI Inc. (see license file)

### Ported / adapted locally

Files under `src/components/home-demo/` are derived from that demo (shell, sidebar, thread, composer, suggestions, messages, styles, shortcuts, rename, thread list item).

### Intentionally not copied

- Docs site runtime (`DocsRuntimeProvider`), auth, analytics, cloud persistence
- `generative-ui.tsx` toolkit / `generative-frame` packages (documented in `src/components/home-demo/generative-ui.md`)
- Account / Memory / conversation budget / command slash-menu backends
- Fullscreen portal and "Explore other examples" marketing chrome
