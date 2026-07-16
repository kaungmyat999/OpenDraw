import { useState, useEffect, useRef } from 'react';
import { Drawnix } from '@drawnix/drawnix';
import { PlaitBoard, PlaitElement, PlaitTheme, Viewport } from '@plait/core';
import localforage from 'localforage';
import { supabase } from '../lib/supabase';
import {
  getDrawing,
  getLatestDrawing,
  countDrawings,
  createDrawing,
  updateContent,
  renameDrawing,
} from '../lib/drawings';
import { AuthModal } from './auth-modal';
import { CanvasPicker, CanvasRecord } from './canvas-picker';
import { SaveStatusIndicator, SaveStatus } from './save-status-indicator';

type AppValue = {
  children: PlaitElement[];
  viewport?: Viewport;
  theme?: PlaitTheme;
};

const CURRENT_DRAWING_ID_KEY = 'current_drawing_id';
// Local per-canvas content backup, keyed by drawing id.
const LOCAL_CONTENT_PREFIX = 'canvas_content_';

// Local backup written on every edit; savedAt lets loadCanvas detect that the
// backup is newer than the server copy (edits the batched upload never sent).
type LocalBackup = { content: AppValue; savedAt: string };
// Batched server upload cadence: local saves are immediate, the server is
// updated at most once per this interval.
const AUTO_SAVE_INTERVAL_MS = 30000;

localforage.config({
  name: 'OpenDraw',
  storeName: 'opendraw_store',
  driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
});

// Cheap, stable fingerprint (djb2) of the diagram itself — elements and theme
// only. Viewport (pan/zoom) and selection are intentionally excluded so that
// mouse movement / panning does not count as a change worth saving.
function hashContent(value: AppValue): string {
  const json = JSON.stringify({
    children: value.children ?? [],
    theme: value.theme ?? null,
  });
  let hash = 5381;
  for (let i = 0; i < json.length; i++) {
    hash = (hash * 33) ^ json.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export function App() {
  const [value, setValue] = useState<AppValue>({ children: [] });
  const [tutorial, setTutorial] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [currentDrawingId, setCurrentDrawingId] = useState<string | null>(null);
  const [currentDrawingName, setCurrentDrawingName] = useState<string>('');
  const [showPicker, setShowPicker] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [renameInput, setRenameInput] = useState('');
  const [showNewCanvasPrompt, setShowNewCanvasPrompt] = useState(false);
  const [newCanvasNameInput, setNewCanvasNameInput] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  // Ref keeps the latest ID available inside debounced callbacks without stale closure
  const currentDrawingIdRef = useRef<string | null>(null);
  const valueRef = useRef<AppValue>({ children: [] });
  // Tracks whether there are edits not yet persisted to the cloud
  const dirtyRef = useRef(false);
  // Hash of the content currently persisted on the server; used to skip
  // redundant server writes when nothing meaningful changed.
  const lastSyncedHashRef = useRef<string | null>(null);
  // Hash of the content last written to localforage; used to avoid
  // redundant local writes on every onChange (panning, selection, etc.).
  const lastLocalHashRef = useRef<string | null>(null);
  // User whose canvas is currently loaded. Supabase re-emits SIGNED_IN on
  // token refresh / tab refocus; without this guard that reload would pull
  // the older server copy over unsaved local edits.
  const loadedUserIdRef = useRef<string | null>(null);

  const setDrawingId = (id: string | null) => {
    setCurrentDrawingId(id);
    currentDrawingIdRef.current = id;
    if (id) localforage.setItem(CURRENT_DRAWING_ID_KEY, id);
  };

  const setValueSync = (v: AppValue) => {
    setValue(v);
    valueRef.current = v;
  };

  const loadCanvas = async (uid: string, drawingId?: string) => {
    // Try the requested canvas; fall back to the most recent if it's gone
    // (e.g. a stale last-open id whose canvas was deleted).
    let data = drawingId ? await getDrawing(uid, drawingId) : null;
    if (!data) data = await getLatestDrawing(uid);

    if (data?.content) {
      setDrawingId(data.id);
      setCurrentDrawingName(data.name);
      const cloudValue = data.content as AppValue;

      // If the local backup holds edits made after the server's copy (the tab
      // closed or reloaded before the batched upload fired), restore it and
      // leave it marked dirty so the autosave pushes it to the server.
      const backup = await localforage.getItem<LocalBackup>(
        LOCAL_CONTENT_PREFIX + data.id
      );
      let value = cloudValue;
      if (
        backup?.savedAt &&
        backup.savedAt > data.updated_at &&
        hashContent(backup.content) !== hashContent(cloudValue)
      ) {
        value = backup.content;
        setValueSync(value);
        lastSyncedHashRef.current = hashContent(cloudValue);
        lastLocalHashRef.current = hashContent(backup.content);
        dirtyRef.current = true;
        setSaveStatus('unsaved');
      } else {
        setValueSync(value);
        markSaved(cloudValue);
      }
      setTutorial(!value.children?.length);
    } else {
      // No canvases yet — create the first one
      await createNewCanvas(uid, true);
    }
  };

  const createNewCanvas = async (uid: string, isFirst = false, customName?: string) => {
    let name = customName?.trim();
    if (!name) {
      const count = await countDrawings(uid);
      name = `Canvas ${count + 1}`;
    }
    const { id } = await createDrawing(uid, name, { children: [] });

    setDrawingId(id);
    setCurrentDrawingName(name);
    setValueSync({ children: [] });
    markSaved({ children: [] });
    setTutorial(true);
  };

  // Marks the canvas as persisted (no pending edits), e.g. right after load.
  const markSaved = (content?: AppValue) => {
    dirtyRef.current = false;
    const hash = hashContent(content ?? valueRef.current);
    lastSyncedHashRef.current = hash;
    lastLocalHashRef.current = hash;
    setSaveStatus('saved');
  };

  // Persist the content locally (fast, always) so nothing is lost even if the
  // server write is skipped or fails.
  const saveLocal = (content: AppValue) => {
    const id = currentDrawingIdRef.current;
    if (!id) return;
    const backup: LocalBackup = {
      content,
      savedAt: new Date().toISOString(),
    };
    localforage.setItem(LOCAL_CONTENT_PREFIX + id, backup).catch((error) => {
      console.error('Failed to save canvas locally', error);
    });
  };

  const saveCurrentCanvas = async (content?: AppValue) => {
    if (!currentDrawingIdRef.current) return;
    const toSave = content ?? valueRef.current;
    const hash = hashContent(toSave);
    // Always keep the local copy up to date first.
    saveLocal(toSave);
    // Skip the network round-trip when the server already has this content.
    if (hash === lastSyncedHashRef.current) {
      dirtyRef.current = false;
      setSaveStatus('saved');
      return;
    }
    setSaveStatus('saving');
    try {
      await updateContent(currentDrawingIdRef.current, toSave);
      lastSyncedHashRef.current = hash;
      dirtyRef.current = false;
      setSaveStatus('saved');
    } catch (error) {
      console.error('Failed to save canvas', error);
      setSaveStatus('error');
    }
  };

  // Called on every onChange: saves locally whenever the content hash changes,
  // and marks dirty (pending server upload) whenever content differs from the
  // last server-synced hash. Viewport/selection changes are filtered by the
  // caller using hashContent, so this only fires on real node edits.
  const handleContentChange = (newValue: AppValue) => {
    const hash = hashContent(newValue);
    if (hash !== lastLocalHashRef.current) {
      saveLocal(newValue);
      lastLocalHashRef.current = hash;
    }
    if (hash !== lastSyncedHashRef.current) {
      dirtyRef.current = true;
      setSaveStatus('unsaved');
    }
  };

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setIsSignedIn(true);
        setUserId(user.id);
        loadedUserIdRef.current = user.id;
        // Try to resume the last open canvas
        const lastId = await localforage.getItem<string>(CURRENT_DRAWING_ID_KEY);
        await loadCanvas(user.id, lastId ?? undefined);
      } else {
        setIsSignedIn(false);
      }
    };

    init();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          // Ignore repeat SIGNED_IN events for the already-loaded user
          // (token refresh, tab refocus) — reloading here would replace
          // unsaved edits with the last-saved server copy.
          if (loadedUserIdRef.current === session.user.id) return;
          loadedUserIdRef.current = session.user.id;
          setIsSignedIn(true);
          setUserId(session.user.id);
          const lastId = await localforage.getItem<string>(CURRENT_DRAWING_ID_KEY);
          await loadCanvas(session.user.id, lastId ?? undefined);
        }
        if (event === 'SIGNED_OUT') {
          setIsSignedIn(false);
          setUserId(null);
          loadedUserIdRef.current = null;
          setDrawingId(null);
          setValueSync({ children: [] });
          setTutorial(false);
          localforage.removeItem(CURRENT_DRAWING_ID_KEY);
        }
      }
    );

    return () => authListener.subscription.unsubscribe();
  }, []);

  // Batched server upload: local saves happen immediately on each edit; the
  // accumulated changes are pushed to the server on this fixed cadence.
  useEffect(() => {
    const interval = setInterval(() => {
      if (dirtyRef.current && currentDrawingIdRef.current) {
        saveCurrentCanvas();
      }
    }, AUTO_SAVE_INTERVAL_MS);
    return () => clearInterval(interval);
    // saveCurrentCanvas relies only on refs / stable setters, so an empty dep
    // array is safe here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Best-effort flush when the tab is hidden or closing so pending edits
  // reach the server without waiting for the 30s timer. If the request gets
  // cut off, the timestamped local backup still restores them on next load.
  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current && currentDrawingIdRef.current) {
        saveCurrentCanvas();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNewCanvas = async () => {
    if (!userId) return;
    const count = await countDrawings(userId);
    setNewCanvasNameInput(`Canvas ${count + 1}`);
    setShowNewCanvasPrompt(true);
  };

  const handleNewCanvasSubmit = async () => {
    if (!userId) { setShowNewCanvasPrompt(false); return; }
    const name = newCanvasNameInput.trim();
    setShowNewCanvasPrompt(false);
    // Flush pending edits to the server before switching away.
    await saveCurrentCanvas();
    await createNewCanvas(userId, false, name);
  };

  const handleSave = async () => {
    await saveCurrentCanvas();
  };

  const handleOpenCanvas = () => setShowPicker(true);

  const handleRename = () => {
    setRenameInput(currentDrawingName);
    setShowRename(true);
  };

  const handleRenameSubmit = async () => {
    const trimmed = renameInput.trim();
    if (!trimmed || !currentDrawingId) { setShowRename(false); return; }
    await renameDrawing(currentDrawingId, trimmed);
    setCurrentDrawingName(trimmed);
    setShowRename(false);
  };

  const handleSelectCanvas = async (canvas: CanvasRecord) => {
    if (!userId || canvas.id === currentDrawingIdRef.current) {
      setShowPicker(false);
      return;
    }
    await saveCurrentCanvas();
    await loadCanvas(userId, canvas.id);
    setShowPicker(false);
  };

  const handleDeleted = async (deletedId: string) => {
    if (!userId) return;
    // Only need to react if the deleted canvas was the one open
    if (deletedId !== currentDrawingIdRef.current) return;
    // Load the most recent remaining canvas, or create a fresh one
    setDrawingId(null);
    await loadCanvas(userId);
  };

  if (isSignedIn === null) return null;
  if (!isSignedIn) return <AuthModal />;

  return (
    <>
      <SaveStatusIndicator status={saveStatus} />
      {showPicker && (
        <CanvasPicker
          currentId={currentDrawingId}
          onSelect={handleSelectCanvas}
          onDeleted={handleDeleted}
          onClose={() => setShowPicker(false)}
        />
      )}
      {showRename && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: 'var(--drawnix-primary-background, #fff)', borderRadius: 8, padding: '24px 28px', minWidth: 320, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Rename canvas</div>
            <input
              autoFocus
              value={renameInput}
              onChange={(e) => setRenameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setShowRename(false); }}
              style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 14, outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowRename(false)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #ccc', cursor: 'pointer', background: 'transparent' }}>Cancel</button>
              <button onClick={handleRenameSubmit} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#1677ff', color: '#fff' }}>Save</button>
            </div>
          </div>
        </div>
      )}
      {showNewCanvasPrompt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: 'var(--drawnix-primary-background, #fff)', borderRadius: 8, padding: '24px 28px', minWidth: 320, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>New canvas</div>
            <input
              autoFocus
              value={newCanvasNameInput}
              onChange={(e) => setNewCanvasNameInput(e.target.value)}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => { if (e.key === 'Enter') handleNewCanvasSubmit(); if (e.key === 'Escape') setShowNewCanvasPrompt(false); }}
              style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 14, outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowNewCanvasPrompt(false)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #ccc', cursor: 'pointer', background: 'transparent' }}>Cancel</button>
              <button onClick={handleNewCanvasSubmit} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#1677ff', color: '#fff' }}>Create</button>
            </div>
          </div>
        </div>
      )}
      <Drawnix
        value={value.children}
        viewport={value.viewport}
        theme={value.theme}
        onChange={(v) => {
          const newValue = v as AppValue;
          setValueSync(newValue);
          handleContentChange(newValue);
          if (newValue.children && newValue.children.length > 0) {
            setTutorial(false);
          }
        }}
        tutorial={tutorial}
        afterInit={(_board: PlaitBoard) => {
          console.log('board initialized');
        }}
        onSignOut={() => supabase.auth.signOut()}
        onNewCanvas={handleNewCanvas}
        onSave={handleSave}
        onOpenCanvas={handleOpenCanvas}
        onRename={handleRename}
      />
    </>
  );
}

export default App;
