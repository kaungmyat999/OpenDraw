<p align="center">
  <picture style="width: 320px">
    <source media="(prefers-color-scheme: light)" srcset="https://github.com/plait-board/drawnix/blob/develop/apps/web/public/logo/logo_drawnix_h.svg?raw=true" />
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/plait-board/drawnix/blob/develop/apps/web/public/logo/logo_drawnix_h_dark.svg?raw=true" />
    <img src="https://github.com/plait-board/drawnix/blob/develop/apps/web/public/logo/logo_drawnix_h.svg?raw=true" width="360" alt="Drawnix logo and name" />
  </picture>
</p>

<div align="center">
  <h2>Open-source whiteboard tool — mind mapping, flowcharts, freehand, and more.</h2>
</div>

<div align="center">
  <figure>
    <a target="_blank" rel="noopener">
      <img src="https://github.com/plait-board/drawnix/blob/develop/apps/web/public/product_showcase/case-2.png" alt="Product showcase" width="80%" />
    </a>
  </figure>
</div>

[*中文*](https://github.com/plait-board/drawnix/blob/develop/README.md) | [*English*](./README_en.md)

---

## Features

- 💯 Free and Open Source (MIT)
- ⚒️ Mind Maps and Flowcharts
- 🖌 Freehand drawing
- 😀 Image support
- 🚀 Plugin-based, extensible architecture
- 🖼️ Export to PNG, JPG, JSON (`.drawnix`)
- 💾 Auto-save (browser storage — see below)
- ⚡ Undo, Redo, Copy, Paste
- 🌌 Infinite canvas — zoom and pan
- 🎨 Theme support
- 📱 Mobile-friendly
- 📈 Mermaid syntax → flowchart conversion
- ✨ Markdown text → mind map conversion

---

## How Drawings Are Stored

By default, Drawnix saves everything **locally in the browser** using [`localforage`](https://github.com/localForage/localForage).

| Driver | Details |
|--------|---------|
| **IndexedDB** (primary) | Stores the full board JSON in the `drawnix_store` object store under the key `main_board_content` |
| **localStorage** (fallback) | Used automatically if IndexedDB is unavailable |

The saved value is a JSON object with three fields:

```ts
{
  children: PlaitElement[]; // all shapes, nodes, and connectors
  viewport?: Viewport;      // zoom level and scroll position
  theme?: PlaitTheme;       // light/dark theme preference
}
```

The save is triggered by the `onChange` callback inside `apps/web/src/app/app.tsx` every time the board state changes.

> **No data leaves the browser by default.** Everything is stored client-side only. See the Supabase section below to add cloud sync.

---

## Authentication

There is **no built-in authentication** in the current version. The app is a fully client-side single-page application — anyone who opens the URL can use it, and each user's data is isolated to their own browser storage.

To add authentication (e.g. for a multi-user or cloud-synced deployment) see the [Supabase Integration](#supabase-integration-cloud-sync--auth) section below.

---

## Supabase Integration (Cloud Sync + Auth)

Yes — **Supabase is a great fit** for adding cloud storage and authentication to Drawnix. Here is how to wire it up.

### 1. Install the Supabase client

```bash
npm install @supabase/supabase-js
```

### 2. Create the database table

Run this in your Supabase SQL editor:

```sql
create table drawings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  name        text not null default 'Untitled',
  content     jsonb not null default '{"children":[]}',
  updated_at  timestamptz not null default now()
);

-- Row-level security: users can only read/write their own drawings
alter table drawings enable row level security;

create policy "owner access"
  on drawings for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

### 3. Initialize Supabase

Create `apps/web/src/lib/supabase.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
```

Add to `apps/web/.env`:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 4. Sync on every change

The `onChange` callback in `app.tsx` is the hook — replace the `localforage.setItem` call with a Supabase upsert:

```ts
onChange={async (value) => {
  setValue(value as AppValue);
  localforage.setItem(MAIN_BOARD_CONTENT_KEY, value); // keep local fallback

  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase
      .from('drawings')
      .upsert({ user_id: user.id, name: 'main', content: value })
      .eq('user_id', user.id);
  }
}}
```

> **Tip:** debounce the upsert (e.g. 500 ms) so you're not hitting the database on every keystroke.

### 5. Load from the cloud on startup

```ts
useEffect(() => {
  const loadData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase
        .from('drawings')
        .select('content')
        .eq('user_id', user.id)
        .single();
      if (data) { setValue(data.content); return; }
    }
    // fall back to local storage
    const storedData = await localforage.getItem(MAIN_BOARD_CONTENT_KEY) as AppValue;
    if (storedData) setValue(storedData);
    else setTutorial(true);
  };
  loadData();
}, []);
```

### 6. Add authentication UI

Supabase supports email/password, magic links, Google, GitHub, and more out of the box:

```ts
// sign up
await supabase.auth.signUp({ email, password });

// sign in
await supabase.auth.signInWithPassword({ email, password });

// OAuth (e.g. Google)
await supabase.auth.signInWithOAuth({ provider: 'google' });

// sign out
await supabase.auth.signOut();
```

Listen for auth state changes to re-load the user's drawing when they sign in:

```ts
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN') loadDrawingFromCloud(session.user);
  if (event === 'SIGNED_OUT') setValue({ children: [] });
});
```

### Architecture with Supabase

```
Browser
  ├── IndexedDB (localforage)   ← offline / instant reads
  └── Supabase
        ├── Auth                ← login / session management
        └── drawings table      ← cloud sync via onChange upsert
```

---

## Development

```bash
npm install
npm run start
```

## Docker

```bash
docker pull pubuzhixing/drawnix:latest
```

## Repository Structure

```
drawnix/
├── apps/
│   └── web/                  # Main web application (drawnix.com)
│       └── src/app/app.tsx   # Board state, localforage save/load
├── packages/
│   ├── drawnix/              # Core whiteboard component
│   ├── react-board/          # React view layer
│   └── react-text/           # Text rendering
├── package.json
└── nx.json
```

## Dependencies

- [plait](https://github.com/worktile/plait) — open-source drawing framework
- [slate](https://github.com/ianstormtaylor/slate) — rich text editor framework
- [localforage](https://github.com/localForage/localForage) — browser storage abstraction
- [floating-ui](https://github.com/floating-ui/floating-ui) — floating UI elements

## Contributing

Any form of contribution is welcome — bug reports, feature suggestions, and pull requests.

## License

[MIT License](./LICENSE)
