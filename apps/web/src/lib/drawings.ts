import { turso } from './turso';

export type CanvasMeta = { id: string; name: string; updated_at: string };

export type DrawingRow = {
  id: string;
  name: string;
  content: unknown;
  updated_at: string;
};

const nowIso = () => new Date().toISOString();

// Fetch a single drawing owned by the user, or null if it doesn't exist.
export async function getDrawing(
  userId: string,
  id: string
): Promise<DrawingRow | null> {
  const rs = await turso.execute({
    sql: 'select id, name, content, updated_at from drawings where user_id = ? and id = ? limit 1',
    args: [userId, id],
  });
  return rowToDrawing(rs.rows[0]);
}

// Most recently updated drawing for the user, or null if they have none.
export async function getLatestDrawing(
  userId: string
): Promise<DrawingRow | null> {
  const rs = await turso.execute({
    sql: 'select id, name, content, updated_at from drawings where user_id = ? order by updated_at desc limit 1',
    args: [userId],
  });
  return rowToDrawing(rs.rows[0]);
}

function rowToDrawing(row: Record<string, unknown> | undefined): DrawingRow | null {
  if (!row) return null;
  return {
    id: row.id as string,
    name: row.name as string,
    content: JSON.parse(row.content as string),
    updated_at: row.updated_at as string,
  };
}

export async function countDrawings(userId: string): Promise<number> {
  const rs = await turso.execute({
    sql: 'select count(*) as n from drawings where user_id = ?',
    args: [userId],
  });
  return Number(rs.rows[0].n);
}

export async function createDrawing(
  userId: string,
  name: string,
  content: unknown
): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await turso.execute({
    sql: 'insert into drawings (id, user_id, name, content, updated_at) values (?, ?, ?, ?, ?)',
    args: [id, userId, name, JSON.stringify(content), nowIso()],
  });
  return { id };
}

export async function updateContent(
  id: string,
  content: unknown
): Promise<void> {
  await turso.execute({
    sql: 'update drawings set content = ?, updated_at = ? where id = ?',
    args: [JSON.stringify(content), nowIso(), id],
  });
}

export async function listCanvases(userId: string): Promise<CanvasMeta[]> {
  const rs = await turso.execute({
    sql: 'select id, name, updated_at from drawings where user_id = ? order by updated_at desc',
    args: [userId],
  });
  return rs.rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    updated_at: r.updated_at as string,
  }));
}

export async function renameDrawing(id: string, name: string): Promise<void> {
  await turso.execute({
    sql: 'update drawings set name = ? where id = ?',
    args: [name, id],
  });
}

export async function deleteDrawing(id: string): Promise<void> {
  await turso.execute({
    sql: 'delete from drawings where id = ?',
    args: [id],
  });
}
