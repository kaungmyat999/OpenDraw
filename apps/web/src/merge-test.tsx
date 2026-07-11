// Temporary dev-only harness for verifying the mindmap merge feature.
// Mounts the Drawnix editor directly, bypassing the Supabase auth gate.
// Not referenced by the production entry; safe to delete.
import * as ReactDOM from 'react-dom/client';
import { Drawnix } from '@drawnix/drawnix';
import { useState } from 'react';
import { PlaitElement } from '@plait/core';

const Test = () => {
  const [value] = useState<PlaitElement[]>([]);
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Drawnix value={value} />
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <Test />
);
