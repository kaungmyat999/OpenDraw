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
  const [showPicker, setShowPicker] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  // Ref keeps the latest ID available inside debounced callbacks without stale closure
  const currentDrawingIdRef = useRef<string | null>(null);
  const valueRef = useRef<AppValue>({ children: [] });
  // Tracks whether there are edits not yet persisted to the cloud
  const dirtyRef = useRef(false);
  // Hash of the content currently persisted on the server; used to skip
  // redundant server writes when nothing meaningful changed.
  const lastSyncedHashRef = useRef<string | null>(null);

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
      const cloudValue = data.content as AppValue;
      setValueSync(cloudValue);
      markSaved(cloudValue);
      setTutorial(!cloudValue.children?.length);
    } else {
      // No canvases yet — create the first one
      await createNewCanvas(uid, true);
    }
  };

  const createNewCanvas = async (uid: string, isFirst = false) => {
    const count = await countDrawings(uid);
    const name = `Canvas ${count + 1}`;
    const { id } = await createDrawing(uid, name, { children: [] });

    setDrawingId(id);
    setValueSync({ children: [] });
    markSaved({ children: [] });
    setTutorial(true);
  };

  // Marks the canvas as persisted (no pending edits), e.g. right after load.
  const markSaved = (content?: AppValue) => {
    dirtyRef.current = false;
    lastSyncedHashRef.current = hashContent(content ?? valueRef.current);
    setSaveStatus('saved');
  };

  // Persist the content locally (fast, always) so nothing is lost even if the
  // server write is skipped or fails.
  const saveLocal = (content: AppValue) => {
    const id = currentDrawingIdRef.current;
    if (!id) return;
    localforage.setItem(LOCAL_CONTENT_PREFIX + id, content).catch((error) => {
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

  // Local-first: persist the edit locally right away and mark it pending. The
  // actual server upload is batched by the periodic interval below.
  const queueLocalChange = (newValue: AppValue) => {
    saveLocal(newValue);
    dirtyRef.current = true;
    setSaveStatus('unsaved');
  };

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setIsSignedIn(true);
        setUserId(user.id);
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
          setIsSignedIn(true);
          setUserId(session.user.id);
          const lastId = await localforage.getItem<string>(CURRENT_DRAWING_ID_KEY);
          await loadCanvas(session.user.id, lastId ?? undefined);
        }
        if (event === 'SIGNED_OUT') {
          setIsSignedIn(false);
          setUserId(null);
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

  const handleNewCanvas = async () => {
    if (!userId) return;
    // Flush pending edits to the server before switching away.
    await saveCurrentCanvas();
    await createNewCanvas(userId);
  };

  const handleSave = async () => {
    await saveCurrentCanvas();
  };

  const handleOpenCanvas = () => setShowPicker(true);

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
      <Drawnix
        value={value.children}
        viewport={value.viewport}
        theme={value.theme}
        onChange={(v) => {
          const newValue = v as AppValue;
          setValueSync(newValue);
          // Only react when the diagram itself changed. Selection, hover,
          // panning and zooming all fire onChange but leave the content hash
          // untouched. On a real edit, save locally now; the server upload is
          // batched by the 30s interval.
          if (hashContent(newValue) !== lastSyncedHashRef.current) {
            queueLocalChange(newValue);
          }
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
      />
    </>
  );
}

export default App;
