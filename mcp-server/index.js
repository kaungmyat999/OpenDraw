#!/usr/bin/env node
/**
 * OpenDraw MCP server.
 *
 * Exposes the user's OpenDraw canvases (stored in Turso) to LLMs:
 * read tools describe every component on a canvas, write tools create
 * shapes, connections, mind maps and standalone text from a prompt.
 *
 * Elements are created with the same @plait/draw helpers the app uses,
 * so everything written here renders identically in the editor.
 *
 * Env (falls back to apps/web/.env):
 *   TURSO_DATABASE_URL / VITE_TURSO_DATABASE_URL
 *   TURSO_AUTH_TOKEN   / VITE_TURSO_AUTH_TOKEN
 *   OPENDRAW_USER_ID   (optional — defaults to the most recently active user)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createClient } from '@libsql/client';
import {
  createGeometryElementWithText,
  createGeometryElementWithoutText,
  createArrowLineElement,
  ArrowLineShape,
  ArrowLineMarkerType,
  BasicShapes,
  FlowchartSymbols,
} from '@plait/draw';
import { parseMarkdownToDrawnix } from '@plait-board/markdown-to-drawnix';

// ---------------------------------------------------------------- env / db

const here = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const [, key, raw] = m;
    if (process.env[key] === undefined) {
      process.env[key] = raw.replace(/^['"]|['"]$/g, '');
    }
  }
}
loadEnvFile(path.join(here, '.env'));
loadEnvFile(path.join(here, '..', 'apps', 'web', '.env'));

const url =
  process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL;
const authToken =
  process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN;

if (!url) {
  console.error(
    'opendraw-mcp: missing TURSO_DATABASE_URL (set it, or keep it in apps/web/.env as VITE_TURSO_DATABASE_URL)'
  );
  process.exit(1);
}

const db = createClient({ url, authToken });

let cachedUserId = null;
async function getUserId() {
  if (cachedUserId) return cachedUserId;
  if (process.env.OPENDRAW_USER_ID) {
    cachedUserId = process.env.OPENDRAW_USER_ID;
    return cachedUserId;
  }
  // Single-user MVP fallback: whoever edited a drawing most recently.
  const rs = await db.execute(
    'select user_id from drawings order by updated_at desc limit 1'
  );
  if (!rs.rows.length) {
    throw new Error(
      'No drawings exist yet and OPENDRAW_USER_ID is not set — open the app once or set the env var.'
    );
  }
  cachedUserId = rs.rows[0].user_id;
  return cachedUserId;
}

/** Load a canvas row; canvasId omitted → most recently updated canvas. */
async function loadCanvas(canvasId) {
  const userId = await getUserId();
  const rs = canvasId
    ? await db.execute({
        sql: 'select id, name, content from drawings where user_id = ? and id = ? limit 1',
        args: [userId, canvasId],
      })
    : await db.execute({
        sql: 'select id, name, content from drawings where user_id = ? order by updated_at desc limit 1',
        args: [userId],
      });
  const row = rs.rows[0];
  if (!row) {
    throw new Error(
      canvasId ? `Canvas ${canvasId} not found` : 'No canvases exist yet'
    );
  }
  const content = JSON.parse(row.content);
  content.children = content.children ?? [];
  return { id: row.id, name: row.name, content };
}

async function saveCanvas(id, content) {
  await db.execute({
    sql: 'update drawings set content = ?, updated_at = ? where id = ?',
    args: [JSON.stringify(content), new Date().toISOString(), id],
  });
}

// ------------------------------------------------------------- element utils

const SHAPE_NAMES = [
  ...Object.values(BasicShapes),
  ...Object.values(FlowchartSymbols),
];

/** Collect plain text out of a Slate-style node tree. */
function slateText(node) {
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  return (node.children ?? []).map(slateText).join('');
}

function paragraph(text) {
  return { children: [{ text }], type: 'paragraph' };
}

/** Bounding box of an element's raw points. */
function rectOf(el) {
  const pts = el.points ?? [];
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

/** A free spot to the right of everything on the canvas. */
function nextFreeSpot(children) {
  let minY = Infinity;
  let maxX = -Infinity;
  for (const el of children) {
    for (const p of el.points ?? []) {
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
    }
  }
  return Number.isFinite(maxX) ? [maxX + 120, minY] : [120, 120];
}

function mindTree(node) {
  return {
    id: node.id,
    text: slateText(node.data?.topic),
    children: (node.children ?? []).map(mindTree),
  };
}

/** LLM-friendly description of one top-level element. */
function describeElement(el) {
  const base = { id: el.id, type: el.type };
  const rect = rectOf(el);
  switch (el.type) {
    case 'geometry': {
      const kind = el.shape === 'text' ? 'text' : 'shape';
      return {
        ...base,
        kind,
        shape: el.shape,
        text: slateText(el.text) || (el.texts ?? []).map((t) => slateText(t.text)).join(' | ') || undefined,
        ...rect,
        fill: el.fill,
        strokeColor: el.strokeColor,
        strokeWidth: el.strokeWidth,
        angle: el.angle || undefined,
      };
    }
    case 'mind':
    case 'mindmap':
      return {
        ...base,
        kind: 'mind-map',
        position: el.points?.[0],
        layout: el.layout,
        topics: mindTree(el),
      };
    case 'arrow-line':
    case 'line':
    case 'vector-line':
      return {
        ...base,
        kind: 'connection',
        shape: el.shape,
        label:
          (el.texts ?? []).map((t) => slateText(t.text)).join(' | ') ||
          undefined,
        sourceBoundId: el.source?.boundId,
        targetBoundId: el.target?.boundId,
        points: el.points,
        strokeColor: el.strokeColor,
      };
    case 'image':
      return { ...base, kind: 'image', url: el.url, ...rect };
    case 'freehand':
      return { ...base, kind: 'freehand-drawing', ...rect };
    default:
      return { ...base, kind: el.type, text: slateText(el.text) || undefined, ...rect };
  }
}

/** Resolve arrow endpoints to element ids + labels for a readable edge list. */
function connectionList(children) {
  const labelById = new Map();
  for (const el of children) {
    if (el.type === 'geometry') {
      labelById.set(el.id, slateText(el.text) || el.shape);
    }
  }
  const edges = [];
  for (const el of children) {
    if (el.type !== 'arrow-line' && el.type !== 'line') continue;
    const endpoint = (handle, fallbackPoint) =>
      handle?.boundId
        ? { elementId: handle.boundId, text: labelById.get(handle.boundId) }
        : { point: fallbackPoint };
    edges.push({
      id: el.id,
      from: endpoint(el.source, el.points?.[0]),
      to: endpoint(el.target, el.points?.[el.points.length - 1]),
      label:
        (el.texts ?? []).map((t) => slateText(t.text)).join(' | ') ||
        undefined,
    });
  }
  return edges;
}

/** Find an element (top-level, or a node inside a mind map) by id. */
function findElement(children, id) {
  for (const el of children) {
    if (el.id === id) return el;
    if (el.type === 'mindmap' || el.type === 'mind') {
      const stack = [...(el.children ?? [])];
      while (stack.length) {
        const node = stack.pop();
        if (node.id === id) return node;
        stack.push(...(node.children ?? []));
      }
    }
  }
  return null;
}

/** Pick facing sides for a connection based on relative element positions. */
function sideConnections(src, tgt) {
  const dx = tgt.x + tgt.width / 2 - (src.x + src.width / 2);
  const dy = tgt.y + tgt.height / 2 - (src.y + src.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? [[1, 0.5], [0, 0.5]]
      : [[0, 0.5], [1, 0.5]];
  }
  return dy >= 0
    ? [[0.5, 1], [0.5, 0]]
    : [[0.5, 0], [0.5, 1]];
}

function connectionPoint(rect, conn) {
  return [rect.x + rect.width * conn[0], rect.y + rect.height * conn[1]];
}

const RELOAD_NOTE =
  'Reload the OpenDraw app (or switch canvases) to see the change. Avoid writing while the canvas has unsaved edits open in the app — its autosave may overwrite this.';

// ------------------------------------------------------------------- server

const server = new McpServer({ name: 'opendraw', version: '0.1.0' });

const ok = (data, note) => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify(note ? { ...data, note } : data, null, 2),
    },
  ],
});

const tool = (name, config, handler) =>
  server.registerTool(name, config, async (args) => {
    try {
      return await handler(args ?? {});
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });

const canvasIdArg = z
  .string()
  .optional()
  .describe('Canvas id; omitted = the most recently updated canvas');

tool(
  'list_canvases',
  {
    title: 'List canvases',
    description:
      "List all of the user's OpenDraw canvases (id, name, last update).",
    inputSchema: {},
  },
  async () => {
    const userId = await getUserId();
    const rs = await db.execute({
      sql: 'select id, name, updated_at from drawings where user_id = ? order by updated_at desc',
      args: [userId],
    });
    return ok({
      canvases: rs.rows.map((r) => ({
        id: r.id,
        name: r.name,
        updated_at: r.updated_at,
      })),
    });
  }
);

tool(
  'describe_canvas',
  {
    title: 'Describe canvas',
    description:
      'Read a canvas and return every component in a structured, readable form: shapes with text/position/size/style, mind maps as topic trees, plus a resolved list of connections between elements. Use this to answer any question about the diagram.',
    inputSchema: { canvas_id: canvasIdArg },
  },
  async ({ canvas_id }) => {
    const { id, name, content } = await loadCanvas(canvas_id);
    const elements = content.children.map(describeElement);
    return ok({
      canvas: { id, name },
      elementCount: elements.length,
      elements,
      connections: connectionList(content.children),
    });
  }
);

tool(
  'get_elements',
  {
    title: 'Get raw elements',
    description:
      'Return the raw Plait JSON of elements on a canvas (all of them, or only the given ids). Use when describe_canvas is not detailed enough.',
    inputSchema: {
      canvas_id: canvasIdArg,
      element_ids: z
        .array(z.string())
        .optional()
        .describe('Only return these elements; omit for all'),
    },
  },
  async ({ canvas_id, element_ids }) => {
    const { id, name, content } = await loadCanvas(canvas_id);
    let elements = content.children;
    if (element_ids?.length) {
      elements = element_ids
        .map((eid) => findElement(content.children, eid))
        .filter(Boolean);
    }
    return ok({ canvas: { id, name }, elements });
  }
);

tool(
  'create_canvas',
  {
    title: 'Create canvas',
    description: 'Create a new, empty canvas with the given name.',
    inputSchema: { name: z.string().describe('Canvas name') },
  },
  async ({ name }) => {
    const userId = await getUserId();
    const id = crypto.randomUUID();
    await db.execute({
      sql: 'insert into drawings (id, user_id, name, content, updated_at) values (?, ?, ?, ?, ?)',
      args: [
        id,
        userId,
        name,
        JSON.stringify({ children: [] }),
        new Date().toISOString(),
      ],
    });
    return ok({ created: { id, name } });
  }
);

const shapeInput = z.object({
  shape: z
    .string()
    .default('rectangle')
    .describe(
      `One of: ${SHAPE_NAMES.join(', ')}. Use "text" for a plain text label.`
    ),
  text: z.string().optional().describe('Text inside the shape'),
  x: z.number().optional().describe('Left edge; omit to auto-place'),
  y: z.number().optional().describe('Top edge; omit to auto-place'),
  width: z.number().default(160),
  height: z.number().default(80),
  fill: z.string().optional().describe('Fill color, e.g. #FFF9B1'),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(),
});

tool(
  'create_shapes',
  {
    title: 'Create shapes',
    description:
      'Add one or more shapes / text labels to a canvas. Coordinates are in canvas units (origin top-left, y grows downward). Returns the new element ids — use them with create_connections. Auto-placed shapes stack vertically to the right of the existing diagram.',
    inputSchema: {
      canvas_id: canvasIdArg,
      shapes: z.array(shapeInput).min(1),
    },
  },
  async ({ canvas_id, shapes }) => {
    const { id, content } = await loadCanvas(canvas_id);
    let auto = null;
    const created = [];
    for (const s of shapes) {
      if (!SHAPE_NAMES.includes(s.shape)) {
        throw new Error(
          `Unknown shape "${s.shape}". Valid shapes: ${SHAPE_NAMES.join(', ')}`
        );
      }
      // Lazily find a free column right of everything (including shapes the
      // caller placed explicitly earlier in this same batch), then stack down.
      if (s.x === undefined && s.y === undefined && !auto) {
        auto = nextFreeSpot(content.children);
      }
      const x = s.x ?? auto[0];
      const y = s.y ?? auto[1];
      if (s.x === undefined && s.y === undefined) auto[1] += s.height + 40;
      const points = [
        [x, y],
        [x + s.width, y + s.height],
      ];
      const style = {};
      if (s.fill) style.fill = s.fill;
      if (s.strokeColor) style.strokeColor = s.strokeColor;
      if (s.strokeWidth) style.strokeWidth = s.strokeWidth;
      let el;
      if (s.text !== undefined && s.text !== '') {
        el = createGeometryElementWithText(s.shape, points, s.text, style);
      } else {
        el = createGeometryElementWithoutText(s.shape, points, style);
      }
      if (s.shape === 'text') {
        el.autoSize = true;
        el.textHeight = s.height;
      }
      content.children.push(el);
      created.push({ id: el.id, shape: s.shape, text: s.text, x, y });
    }
    await saveCanvas(id, content);
    return ok({ canvas_id: id, created }, RELOAD_NOTE);
  }
);

const connectionInput = z.object({
  source_id: z.string().describe('Element id the connection starts from'),
  target_id: z.string().describe('Element id the connection points to'),
  label: z.string().optional().describe('Text shown on the connection'),
  shape: z.enum(['elbow', 'straight', 'curve']).default('elbow'),
  arrow_start: z.boolean().default(false).describe('Arrowhead at source'),
  arrow_end: z.boolean().default(true).describe('Arrowhead at target'),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(),
});

tool(
  'create_connections',
  {
    title: 'Connect elements',
    description:
      'Create arrow connections between existing shapes (by element id, from describe_canvas or create_shapes). Connection sides are picked automatically from the relative positions of the two elements.',
    inputSchema: {
      canvas_id: canvasIdArg,
      connections: z.array(connectionInput).min(1),
    },
  },
  async ({ canvas_id, connections }) => {
    const { id, content } = await loadCanvas(canvas_id);
    const created = [];
    for (const c of connections) {
      const src = findElement(content.children, c.source_id);
      const tgt = findElement(content.children, c.target_id);
      if (!src) throw new Error(`source_id ${c.source_id} not found`);
      if (!tgt) throw new Error(`target_id ${c.target_id} not found`);
      const srcRect = rectOf(src);
      const tgtRect = rectOf(tgt);
      if (!srcRect || !tgtRect || src.type.startsWith('mind') || tgt.type.startsWith('mind')) {
        throw new Error(
          'Connections can only bind shapes/text/images (not mind-map nodes)'
        );
      }
      const [srcConn, tgtConn] = sideConnections(srcRect, tgtRect);
      const line = createArrowLineElement(
        ArrowLineShape[c.shape],
        [connectionPoint(srcRect, srcConn), connectionPoint(tgtRect, tgtConn)],
        {
          marker: c.arrow_start
            ? ArrowLineMarkerType.arrow
            : ArrowLineMarkerType.none,
          boundId: c.source_id,
          connection: srcConn,
        },
        {
          marker: c.arrow_end
            ? ArrowLineMarkerType.arrow
            : ArrowLineMarkerType.none,
          boundId: c.target_id,
          connection: tgtConn,
        },
        c.label ? [{ text: paragraph(c.label), position: 0.5 }] : [],
        {
          ...(c.strokeColor ? { strokeColor: c.strokeColor } : {}),
          ...(c.strokeWidth ? { strokeWidth: c.strokeWidth } : {}),
        }
      );
      content.children.push(line);
      created.push({ id: line.id, from: c.source_id, to: c.target_id });
    }
    await saveCanvas(id, content);
    return ok({ canvas_id: id, created }, RELOAD_NOTE);
  }
);

tool(
  'create_mind_map',
  {
    title: 'Create mind map',
    description:
      'Create a mind map from markdown. Format: a "# Heading" as the central topic, then nested "-" list items as branches. Example:\n# Project\n- Phase 1\n  - Task A\n- Phase 2',
    inputSchema: {
      canvas_id: canvasIdArg,
      markdown: z.string().describe('Markdown outline of the mind map'),
      x: z.number().optional().describe('Root position; omit to auto-place'),
      y: z.number().optional(),
    },
  },
  async ({ canvas_id, markdown, x, y }) => {
    const { id, content } = await loadCanvas(canvas_id);
    const mind = parseMarkdownToDrawnix(markdown);
    const [autoX, autoY] = nextFreeSpot(content.children);
    mind.points = [[x ?? autoX, y ?? autoY]];
    content.children.push(mind);
    await saveCanvas(id, content);
    return ok(
      { canvas_id: id, created: { id: mind.id, topics: mindTree(mind) } },
      RELOAD_NOTE
    );
  }
);

tool(
  'update_element_text',
  {
    title: 'Update element text',
    description:
      'Replace the text of an existing element: a shape, a text label, a mind-map node, or a connection label.',
    inputSchema: {
      canvas_id: canvasIdArg,
      element_id: z.string(),
      text: z.string(),
    },
  },
  async ({ canvas_id, element_id, text }) => {
    const { id, content } = await loadCanvas(canvas_id);
    const el = findElement(content.children, element_id);
    if (!el) throw new Error(`Element ${element_id} not found`);
    if (el.data?.topic) {
      el.data.topic = paragraph(text);
    } else if (el.type === 'arrow-line' || el.type === 'line') {
      el.texts = [{ text: paragraph(text), position: 0.5 }];
    } else if (el.texts?.length) {
      el.texts[0].text = paragraph(text);
    } else {
      el.text = { ...paragraph(text), align: el.text?.align ?? 'center' };
    }
    await saveCanvas(id, content);
    return ok({ canvas_id: id, updated: element_id }, RELOAD_NOTE);
  }
);

tool(
  'delete_elements',
  {
    title: 'Delete elements',
    description:
      'Delete elements by id (top-level elements or mind-map nodes). Connections bound to a deleted element are removed too.',
    inputSchema: {
      canvas_id: canvasIdArg,
      element_ids: z.array(z.string()).min(1),
    },
  },
  async ({ canvas_id, element_ids }) => {
    const { id, content } = await loadCanvas(canvas_id);
    const ids = new Set(element_ids);
    const before = content.children.length;
    // Top-level removals, plus any connection bound to a removed element.
    content.children = content.children.filter((el) => {
      if (ids.has(el.id)) return false;
      if (
        (el.type === 'arrow-line' || el.type === 'line') &&
        (ids.has(el.source?.boundId) || ids.has(el.target?.boundId))
      ) {
        return false;
      }
      return true;
    });
    // Mind-map subtree removals.
    const pruneMind = (node) => {
      node.children = (node.children ?? []).filter((c) => !ids.has(c.id));
      node.children.forEach(pruneMind);
    };
    for (const el of content.children) {
      if (el.type === 'mindmap' || el.type === 'mind') pruneMind(el);
    }
    await saveCanvas(id, content);
    return ok(
      {
        canvas_id: id,
        removedTopLevel: before - content.children.length,
      },
      RELOAD_NOTE
    );
  }
);

// -------------------------------------------------------------------- start

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('opendraw-mcp: connected (stdio)');
