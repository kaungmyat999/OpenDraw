import { Dialog, DialogContent } from '../dialog/dialog';
import { useDrawnix } from '../../hooks/use-drawnix';
import './export-image-confirm.scss';
import { useBoard } from '@plait-board/react-board';
import { useI18n } from '../../i18n';
import { saveAsImage, saveAsSvg } from '../../utils/image';

export const ExportImageConfirm = ({
  container,
}: {
  container: HTMLElement | null;
}) => {
  const { appState, setAppState } = useDrawnix();
  const { t } = useI18n();
  const board = useBoard();
  const format = appState.pendingImageExport ?? null;

  const close = () => {
    setAppState({ ...appState, pendingImageExport: null });
  };

  const confirm = () => {
    switch (format) {
      case 'svg':
        saveAsSvg(board);
        break;
      case 'png':
        saveAsImage(board, true);
        break;
      case 'jpg':
        saveAsImage(board, false);
        break;
    }
    close();
  };

  return (
    <Dialog
      open={!!format}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="export-image-confirm" container={container}>
        <h2 className="export-image-confirm__title">
          {t('exportConfirm.title')}
        </h2>
        <p className="export-image-confirm__description">
          {t('exportConfirm.description').replace(
            '{format}',
            (format ?? '').toUpperCase()
          )}
        </p>
        <div className="export-image-confirm__actions">
          <button
            className="export-image-confirm__button export-image-confirm__button--cancel"
            onClick={close}
          >
            {t('cleanConfirm.cancel')}
          </button>
          <button
            className="export-image-confirm__button export-image-confirm__button--ok"
            autoFocus
            onClick={confirm}
          >
            {t('exportConfirm.confirm')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
