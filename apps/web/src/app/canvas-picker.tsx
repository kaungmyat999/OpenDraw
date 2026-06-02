import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import styles from './canvas-picker.module.scss';

export type CanvasRecord = {
  id: string;
  name: string;
  updated_at: string;
};

type Props = {
  currentId: string | null;
  onSelect: (canvas: CanvasRecord) => void;
  onDeleted: (deletedId: string) => void;
  onClose: () => void;
};

export function CanvasPicker({ currentId, onSelect, onDeleted, onClose }: Props) {
  const [canvases, setCanvases] = useState<CanvasRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('drawings')
        .select('id, name, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });
      setCanvases(data ?? []);
      setLoading(false);
    };
    load();
  }, []);

  useEffect(() => {
    if (editingId) inputRef.current?.focus();
  }, [editingId]);

  const startRename = (c: CanvasRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteId(null);
    setEditingId(c.id);
    setEditingName(c.name);
  };

  const commitRename = async (id: string) => {
    const trimmed = editingName.trim();
    if (!trimmed) { setEditingId(null); return; }
    await supabase.from('drawings').update({ name: trimmed }).eq('id', id);
    setCanvases((prev) => prev.map((c) => c.id === id ? { ...c, name: trimmed } : c));
    setEditingId(null);
  };

  const handleRenameKey = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') commitRename(id);
    if (e.key === 'Escape') setEditingId(null);
  };

  const requestDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
    setConfirmDeleteId(id);
  };

  const confirmDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await supabase.from('drawings').delete().eq('id', id);
    setCanvases((prev) => prev.filter((c) => c.id !== id));
    setConfirmDeleteId(null);
    onDeleted(id);
  };

  const cancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteId(null);
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Your Canvases</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {loading ? (
          <p className={styles.empty}>Loading…</p>
        ) : canvases.length === 0 ? (
          <p className={styles.empty}>No canvases yet.</p>
        ) : (
          <ul className={styles.list}>
            {canvases.map((c) => (
              <li
                key={c.id}
                className={`${styles.item} ${c.id === currentId ? styles.active : ''}`}
                onClick={() => editingId !== c.id && confirmDeleteId !== c.id && onSelect(c)}
              >
                {/* Name / rename input */}
                {editingId === c.id ? (
                  <input
                    ref={inputRef}
                    className={styles.renameInput}
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => handleRenameKey(e, c.id)}
                    onBlur={() => commitRename(c.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className={styles.name}>{c.name}</span>
                )}

                {/* Date — hidden while editing */}
                {editingId !== c.id && (
                  <span className={styles.date}>{formatDate(c.updated_at)}</span>
                )}

                {/* Confirm-delete state */}
                {confirmDeleteId === c.id ? (
                  <div className={styles.confirmRow} onClick={(e) => e.stopPropagation()}>
                    <span className={styles.confirmText}>Delete?</span>
                    <button className={`${styles.actionBtn} ${styles.danger}`} onClick={(e) => confirmDelete(c.id, e)}>Yes</button>
                    <button className={styles.actionBtn} onClick={cancelDelete}>No</button>
                  </div>
                ) : editingId === c.id ? (
                  <div className={styles.confirmRow} onClick={(e) => e.stopPropagation()}>
                    <button className={`${styles.actionBtn} ${styles.primary}`} onClick={() => commitRename(c.id)}>Save</button>
                    <button className={styles.actionBtn} onClick={(e) => { e.stopPropagation(); setEditingId(null); }}>Cancel</button>
                  </div>
                ) : (
                  <div className={styles.actions}>
                    <button className={styles.actionBtn} title="Rename" onClick={(e) => startRename(c, e)}>✏</button>
                    <button className={`${styles.actionBtn} ${styles.deleteBtn}`} title="Delete" onClick={(e) => requestDelete(c.id, e)}>🗑</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
