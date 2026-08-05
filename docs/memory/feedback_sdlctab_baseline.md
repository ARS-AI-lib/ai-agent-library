---
name: feedback-sdlctab-baseline
description: "SDLCTab.jsx/.css known-good baseline — do not regress with sed edits, treat as protected"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5b7ada72-a449-4ebc-b37a-4269b922e007
---

The working version of the SDLC AI Adoption tab is now confirmed correct and live. Treat these exact files as the protected baseline — do not modify them with incremental `sed`/sed-insert edits again.

- `src/components/SDLCTab.jsx` — has `renderLegend()` as its own function, `renderBoard()` for the process board (GROUPS-based), `renderUseCaseView()` for the use-case grid, full `cbar` filter row (Use Cases toggle pill → View/Stage dropdowns when toggled on → Owner/Role/Process-Owner `MultiSelect` → Has-agent pill → clear `btnclr` button), and a modal with Owner/Creator/Phase rows.
- `src/styles/SDLCTab.css` — scoped classes only (`.sdlc-tab`, `.adopt-board`, `.aproc*`, `.uc-*`, `.sdlc-m*`), reuses `.cbar/.cg/.cl/.dd/.csep/.btnclr/.pill/.sb/.sh/.sbar/.sname/.ms-*/.legend/.lg/.lsep` from `theme.css` — never redefines them.
- `src/styles/theme.css` — already has `.nav-tab`/`.nav-tabs`/`.pill` appended once (verified no duplicates).

**Why:** A long debugging session broke this component repeatedly via `sed -i` line-targeted edits (wrong line numbers deleted half the file, inserted code mid-expression, left `renderCards()` as a placeholder instead of calling `renderBoard()`, used wrong variable names `stages`/`stageFilter` instead of `ALL_STAGES`/`stage`). The user finally gave the actual three correct files directly and said "ยึด Code นี้ไว้ อย่าให้พังอีก."

**How to apply:** A local clone of the repo now exists at `/Users/tinpato/Downloads/claude_AIApp/agent-library/` (Mac) in addition to the Cloud Shell copy at `~/agent-library`. Before editing `SDLCTab.jsx`/`SDLCTab.css` again:
1. Diff the local file against this memory's described structure first — don't blind-patch with `sed` line numbers.
2. Prefer Edit/Write (whole-file rewrite) over `sed -i` for JSX — `sed` line-offset edits caused every regression in this session.
3. If working in Cloud Shell only (no local clone access), use a quoted heredoc (`cat > file << 'EOF'`) to paste a complete, already-correct file rather than patching incrementally.
4. See [[feedback-cloudshell-workflow]] for the broader environment-switching context.
