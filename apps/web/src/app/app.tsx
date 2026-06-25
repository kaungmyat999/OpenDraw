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

type AppValue = {
  children: PlaitElement[];
  viewport?: Viewport;
  theme?: PlaitTheme;
};

const CURRENT_DRAWING_ID_KEY = 'current_drawing_id';
const SYNC_DEBOUNCE_MS = 600;

localforage.config({
  name: 'OpenDraw',
  storeName: 'opendraw_store',
  driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
});

export function App() {
  const [value, setValue] = useState<AppValue>({ children: [] });
  const [tutorial, setTutorial] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [currentDrawingId, setCurrentDrawingId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref keeps the latest ID available inside debounced callbacks without stale closure
  const currentDrawingIdRef = useRef<string | null>(null);
  const valueRef = useRef<AppValue>({ children: [] });

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
    setTutorial(true);
  };

  const saveCurrentCanvas = async (content?: AppValue) => {
    if (!currentDrawingIdRef.current) return;
    await updateContent(currentDrawingIdRef.current, content ?? valueRef.current);
  };

  const syncToSupabase = (newValue: AppValue) => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => saveCurrentCanvas(newValue), SYNC_DEBOUNCE_MS);
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

  const handleNewCanvas = async () => {
    if (!userId) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    await saveCurrentCanvas();
    await createNewCanvas(userId);
  };

  const handleSave = async () => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    await saveCurrentCanvas();
  };

  const handleOpenCanvas = () => setShowPicker(true);

  const handleSelectCanvas = async (canvas: CanvasRecord) => {
    if (!userId || canvas.id === currentDrawingIdRef.current) {
      setShowPicker(false);
      return;
    }
    if (syncTimer.current) clearTimeout(syncTimer.current);
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
          syncToSupabase(newValue);
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
