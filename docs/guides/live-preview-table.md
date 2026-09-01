# Markdown Table Editing

Markdown tables are rendered as an interactive grid widget
(`packages/core/src/live-preview-table.ts`). This file is the most fragile part
of the codebase — the rules below are the result of many hard-won bug fixes.
**Read and follow them before touching table code.**

## Core interaction model

The table is a contentEditable grid inside a CM6 widget. Because CM6 owns the
underlying document, every in-cell edit is eventually written back to the
markdown. Table cells use `contentEditable` only while actively editing.

## The rules (from AGENTS.md — do not regress)

1. **Never clear state you just set in the same flow.** Trace the full
   lifecycle (mousedown → mousemove → mouseup) before changing cleanup logic.
2. **rAF polling must respect *all* active interaction states.** Before
   clearing state in a rAF loop, check `isRangeSelecting`, `cellMouseDown`,
   `self.editing`, **and** `rangeActive`.
3. **Never use inline `border*` styles for drag indicators.** Use `box-shadow`
   or absolute overlay divs. Setting `border` on cells destroys structural
   borders on cleanup.
4. **`contentEditable` is off by default** on cells. Activate on
   mousedown→focus, deactivate on blur — otherwise browser text selection leaks
   into cells from outside.
5. **HTML5 Drag API is forbidden** for table grips. Use custom
   mousedown/mousemove/mouseup. HTML5 drag creates ghost images and can't be
   constrained to the table.
6. **Column grip pills position relative to header cells** (absolute overlay or
   inline in the header), NOT a separate `<tr>` row.
7. **Test every change with ALL interaction paths:** click-to-edit,
   drag-to-select-range, grip-click-to-select-column, grip-drag-to-reorder,
   click-outside-to-deselect, delete-key-on-selection.
8. **Any multi-frame mouse interaction MUST set `self.editing = true` and
   increment `tableEditingCount`**, releasing in `mouseup`. This prevents CM6
   from recreating the widget DOM mid-interaction.
9. **Cell `blur` handlers MUST guard for active grip drag**
   (`if (draggingCol < 0 && draggingRow < 0)`) before clearing `editing`.
10. **`onDragEnd` MUST release the editing lock *before* dispatching
    moveColumn/moveRow** — otherwise the column move updates the markdown but
    the widget shows the old order.
11. **`rangeActive` persists after mouseup** for multi-cell selections; it is
    only cleared by explicit `clearRangeSelection`.
12. **StateField update must skip ALL rebuilds during `isTableEditing()`** —
    both `docChanged` and selection-only changes.

## Finding the code

- `isTableEditing(view)` / `flushPendingTableEdits(view)` — editing-lock helpers.
- `EditableTableWidget` — the grid widget.
- The AGENTS.md "Table Widget Development Rules" section is the authoritative
  source; keep this guide in sync with it.
