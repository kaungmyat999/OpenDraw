import { createClient } from '@libsql/client/web';

const url = import.meta.env.VITE_TURSO_DATABASE_URL as string;
const authToken = import.meta.env.VITE_TURSO_AUTH_TOKEN as string;

// Browser (HTTP) libSQL client. NOTE: the auth token ships to the client, and
// Turso has no row-level security — every user shares access to this database.
// Fine for personal/MVP use; put Turso behind a backend before exposing publicly.
export const turso = createClient({ url, authToken });
