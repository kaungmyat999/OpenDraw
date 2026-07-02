import styles from './save-status-indicator.module.scss';

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: 'All changes saved',
  saving: 'Saving…',
  unsaved: 'Unsaved changes',
  error: 'Save failed',
};

export function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  return (
    <div
      className={`${styles.indicator} ${styles[status]}`}
      role="status"
      aria-live="polite"
    >
      <span className={styles.dot} />
      <span className={styles.label}>{STATUS_LABEL[status]}</span>
    </div>
  );
}
