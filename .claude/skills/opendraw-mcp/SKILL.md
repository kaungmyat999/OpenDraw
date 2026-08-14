---
name: opendraw-mcp
description: Read and edit OpenDraw canvases through the opendraw MCP server — describe diagrams, create shapes/flowcharts, connect elements with arrows, build mind maps from markdown, update or delete elements. Use whenever the user asks about the content of a canvas/diagram or wants shapes, flowcharts, connections, or mind maps created or changed.
---

# OpenDraw MCP

The `opendraw` MCP server (registered in `.mcp.json`, source in `mcp-server/index.js`) talks directly to the same Turso database the web app uses. Elements it creates use the same `@plait/draw` helpers as the app, so they render identically in the editor.

All tools take an optional `canvas_id`; **omitted means the most recently updated canvas**. When the user says "my canvas" without naming one, that default is usually right — but if several canvases exist and it's ambiguous, run `list_canvases` first and confirm.

## Tools

Read:
- `list_canvases` — all canvases (id, name, last update).
- `describe_canvas` — every element in readable form: shapes with text/position/size/style, mind maps as topic trees, plus a resolved connection list. **Start here for any question about a diagram.**
- `get_elements` — raw Plait JSON (whole canvas or specific `element_ids`). Only when `describe_canvas` omits a detail you need.

Write:
- `create_canvas` — new empty canvas from a `name`.
- `create_shapes` — batch-create shapes / flowchart symbols / text labels. Returns new element ids.
- `create_connections` — arrows between existing elements by id. Sides are picked automatically from relative positions.
- `create_mind_map` — mind map from a markdown outline.
- `update_element_text` — replace text of a shape, text label, mind-map node, or connection label.
- `delete_elements` — delete by id; arrows bound to deleted elements are cleaned up automatically.

## Building a diagram (typical flow)

1. `describe_canvas` to see what's already there (skip for a fresh canvas).
2. `create_shapes` with explicit `x`/`y` when layout matters. Coordinates are canvas units, origin top-left, y grows **downward**. Default size 160×80; leave ~60–100px gaps between connected shapes.
3. `create_connections` using the ids returned by step 2. `shape` is `elbow` (default), `straight`, or `curve`; `arrow_end` defaults to true, add `label` for edge text.
4. One batch call per tool — both `create_shapes` and `create_connections` accept arrays.

If you omit `x`/`y`, shapes auto-place in a column to the right of the existing diagram — fine for loose notes, not for flowcharts. For flowcharts, lay out explicitly (e.g. vertical flow: same x, y increasing ~160 per step; decision branches offset horizontally).

## Valid shape names

Basic: `rectangle`, `ellipse`, `diamond`, `roundRectangle`, `parallelogram`, `text`, `triangle`, `leftArrow`, `trapezoid`, `rightArrow`, `cross`, `star`, `pentagon`, `hexagon`, `octagon`, `pentagonArrow`, `processArrow`, `twoWayArrow`, `comment`, `roundComment`, `cloud`

Flowchart: `process`, `decision`, `data`, `connector`, `terminal`, `manualInput`, `preparation`, `manualLoop`, `merge`, `delay`, `storedData`, `or`, `summingJunction`, `predefinedProcess`, `offPage`, `document`, `multiDocument`, `database`, `hardDisk`, `internalStorage`, `noteCurlyRight`, `noteCurlyLeft`, `noteSquare`, `display`

Use `text` for a standalone label. Flowchart conventions: `terminal` for start/end, `process` for steps, `decision` for branches, `data` for I/O.

Styling: `fill` (e.g. `#FFF9B1`), `strokeColor`, `strokeWidth` on shapes; `strokeColor`/`strokeWidth` on connections.

## Mind maps

`create_mind_map` takes a markdown outline — one `# Heading` as the central topic, nested `-` items as branches:

```markdown
# Project
- Phase 1
  - Task A
- Phase 2
```

Mind-map nodes appear in `describe_canvas` as a topic tree with per-node ids. Those ids work with `update_element_text` and `delete_elements` (deleting a node removes its subtree), but **connections cannot bind to mind-map nodes** — only to shapes, text, and images.

## Caveats

- **The app doesn't live-reload MCP writes.** After writing, tell the user to reload the app (or switch canvases) to see changes.
- **Don't write to a canvas the user has open with unsaved edits** — the app autosaves every 30s and whichever save lands last wins (content is written whole). If the user is actively editing, ask them to let it save / close it first.
- Deletes have no undo through MCP. Confirm before deleting anything you didn't just create.
- Credentials come from `apps/web/.env`; the server operates on the most recently active user unless `OPENDRAW_USER_ID` is set.
- End-to-end check: `node mcp-server/smoke-test.mjs` exercises every tool against a throwaway canvas.
