# OpenDraw MCP Server

An [MCP](https://modelcontextprotocol.io) server that lets any LLM client
(Claude Code, Claude Desktop, etc.) **read your OpenDraw diagrams and create
nodes from a prompt**. It talks directly to the same Turso database the web
app uses, and builds elements with the same `@plait/draw` helpers, so
everything it creates renders identically in the editor.

## Setup

No build step. Dependencies resolve from the repo root `node_modules`
(run `npm install` at the repo root once).

Credentials are picked up automatically from `apps/web/.env`
(`VITE_TURSO_DATABASE_URL` / `VITE_TURSO_AUTH_TOKEN`). You can override with
plain `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` env vars.

By default the server operates on the **most recently active user's**
drawings (fine for a personal instance). To pin a user, set
`OPENDRAW_USER_ID` to a Supabase user id.

### Claude Code

Already registered via `.mcp.json` at the repo root — open Claude Code in
this repo and approve the `opendraw` server. From anywhere else:

```sh
claude mcp add opendraw -- node /path/to/OpenDraw/mcp-server/index.js
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "opendraw": {
      "command": "node",
      "args": ["/path/to/OpenDraw/mcp-server/index.js"]
    }
  }
}
```

## Tools

Read:

| Tool | What it does |
| --- | --- |
| `list_canvases` | All canvases with id, name, last update |
| `describe_canvas` | Every component in LLM-friendly form: shapes (text, position, size, style), mind maps as topic trees, and a resolved connection list (`A --label--> B`) |
| `get_elements` | Raw Plait JSON, for details `describe_canvas` omits |

Write:

| Tool | What it does |
| --- | --- |
| `create_canvas` | New empty canvas |
| `create_shapes` | Batch-create shapes / flowchart symbols / text labels (22 basic + 24 flowchart shapes, with fill/stroke styling and auto-placement) |
| `create_connections` | Arrows between elements by id, with optional labels; connection sides picked automatically |
| `create_mind_map` | Mind map from a markdown outline (`# Root` + nested `-` items) |
| `update_element_text` | Rewrite text of a shape, mind node, or arrow label |
| `delete_elements` | Delete elements; arrows bound to them are cleaned up too |

Example prompts once connected:

- *"What does my architecture diagram show? Which services talk to the database?"*
- *"Add a flowchart for user signup: start → validate email → decision 'exists?' → yes: show error, no: create account → end."*
- *"Create a mind map for my Q3 marketing plan on a new canvas."*

## Caveats

- The web app batches saves every 30 s and only loads content when a canvas
  is opened. **Reload the app after MCP writes**, and avoid MCP writes while
  the same canvas has unsaved edits open in the app — whichever saves last
  wins (the content column is written whole).
- `smoke-test.mjs` exercises every tool end-to-end against a throwaway
  canvas: `node mcp-server/smoke-test.mjs`.
