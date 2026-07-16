// Throwaway end-to-end test: spins up the server over stdio, exercises every
// tool against a temporary canvas, then deletes the canvas. Not shipped.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(
  new StdioClientTransport({
    command: 'node',
    args: [new URL('./index.js', import.meta.url).pathname],
  })
);

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? '';
  if (res.isError) throw new Error(`${name} failed: ${text}`);
  console.log(`\n=== ${name} ===\n${text.slice(0, 1200)}`);
  return JSON.parse(text);
};

const tools = await client.listTools();
console.log('tools:', tools.tools.map((t) => t.name).join(', '));

await call('list_canvases');

const { created: canvas } = await call('create_canvas', {
  name: '__mcp_smoke_test__',
});

const shapes = await call('create_shapes', {
  canvas_id: canvas.id,
  shapes: [
    { shape: 'terminal', text: 'Start', x: 100, y: 100, width: 140, height: 60 },
    { shape: 'decision', text: 'Valid?', x: 100, y: 260, width: 160, height: 90, fill: '#FFF9B1' },
    { shape: 'process', text: 'Save record', x: 400, y: 275, width: 160, height: 60 },
    { shape: 'text', text: 'A note label' },
  ],
});
const [start, decision, save] = shapes.created.map((s) => s.id);

await call('create_connections', {
  canvas_id: canvas.id,
  connections: [
    { source_id: start, target_id: decision },
    { source_id: decision, target_id: save, label: 'yes', shape: 'elbow' },
  ],
});

await call('create_mind_map', {
  canvas_id: canvas.id,
  markdown: '# Plan\n- Phase 1\n  - Design\n- Phase 2',
});

await call('update_element_text', {
  canvas_id: canvas.id,
  element_id: save,
  text: 'Persist record',
});

const desc = await call('describe_canvas', { canvas_id: canvas.id });
if (desc.elementCount !== 7) throw new Error(`expected 7 elements, got ${desc.elementCount}`);
if (!desc.connections.some((c) => c.label === 'yes' && c.to.text === 'Persist record'))
  throw new Error('connection resolution failed');

await call('get_elements', { canvas_id: canvas.id, element_ids: [decision] });

await call('delete_elements', {
  canvas_id: canvas.id,
  element_ids: [decision],
});
const after = await call('describe_canvas', { canvas_id: canvas.id });
// decision + its two bound connections gone: 7 - 3 = 4
if (after.elementCount !== 4) throw new Error(`expected 4 after delete, got ${after.elementCount}`);

console.log('\nAll assertions passed. Cleaning up test canvas…');
await client.close();

// Remove the test canvas directly.
const { createClient } = await import('@libsql/client');
const fs = await import('node:fs');
const env = fs.readFileSync(new URL('../apps/web/.env', import.meta.url), 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1];
const db = createClient({
  url: get('VITE_TURSO_DATABASE_URL'),
  authToken: get('VITE_TURSO_AUTH_TOKEN'),
});
await db.execute({ sql: 'delete from drawings where id = ?', args: [canvas.id] });
console.log('Test canvas deleted. Done.');
