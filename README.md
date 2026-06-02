# OpenDraw

A web-based collaborative whiteboard built on top of [Drawnix](https://github.com/plait-board/drawnix) and the [Plait](https://github.com/worktile/plait) drawing framework. It extends the open-source core with user authentication and per-user cloud storage via Supabase.

## What it does

- Draw on an infinite canvas — mind maps, flowcharts, freehand, shapes, and text
- Sign in with email/password; each user's canvases are private to their account
- Multiple canvases per user — create, rename, open, and delete from the canvas picker
- Auto-saves to Supabase every 600 ms; manual save available from the menu
- Exports to PNG, JPG, or SVG

## Stack

- **React 19** + **Vite** (Nx monorepo)
- **Plait / Drawnix** — drawing engine and whiteboard UI
- **Supabase** — auth (PKCE flow) and `drawings` table (one row per canvas)

## Getting started

```bash
npm install
```

Create `apps/web/.env`:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Run the database schema in your Supabase SQL editor (`supabase-schema.sql`), then:

```bash
npm run start   # http://localhost:7200
```

## Structure

```
apps/web/          # React SPA — auth, canvas picker, Supabase sync
packages/drawnix/  # Whiteboard component (toolbar, tools, plugins)
packages/react-board/  # React rendering layer for Plait
```

## License

[MIT](./LICENSE)
