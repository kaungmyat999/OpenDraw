import {
  CloudSaveIcon,
  ExportImageIcon,
  NewCanvasIcon,
  OpenFileIcon,
  SaveFileIcon,
  SignOutIcon,
  TrashIcon,
} from '../../icons';
import { useBoard, useListRender } from '@plait-board/react-board';
import {
  BoardTransforms,
  PlaitBoard,
  PlaitElement,
  PlaitTheme,
  ThemeColorMode,
  Viewport,
} from '@plait/core';
import { saveAsJSON, saveJSON } from '../../../data/json';
import MenuItem from '../../menu/menu-item';
import { saveAsImage, saveAsSvg } from '../../../utils/image';
import { useDrawnix } from '../../../hooks/use-drawnix';
import { useI18n } from '../../../i18n';
import Menu from '../../menu/menu';
import { useContext } from 'react';
import { MenuContentPropsContext } from '../../menu/common';
import { EVENT } from '../../../constants';
import { getShortcutKey } from '../../../utils/common';

export const SaveToFile = () => {
  const board = useBoard();
  const { appState, setAppState } = useDrawnix();
  const { t } = useI18n();
  if (!appState.fileHandle) {
    return null;
  }
  return (
    <MenuItem
      data-testid="save-button"
      onSelect={() => {
        saveJSON(board, appState.fileHandle).then(({ fileHandle }) => {
          setAppState((currentAppState) => ({
            ...currentAppState,
            fileHandle,
          }));
        });
      }}
      icon={SaveFileIcon}
      aria-label={t('menu.saveFile')}
      shortcut={getShortcutKey('CtrlOrCmd+S')}
    >{t('menu.saveFile')}</MenuItem>
  );
};
SaveToFile.displayName = 'SaveToFile';

export const SaveToCloud = () => {
  const { t } = useI18n();
  const { onSave } = useDrawnix();

  if (!onSave) return null;

  return (
    <MenuItem
      data-testid="cloud-save-button"
      onSelect={onSave}
      icon={CloudSaveIcon}
      aria-label={t('menu.save')}
      shortcut={getShortcutKey('CtrlOrCmd+Shift+S')}
    >
      {t('menu.save')}
    </MenuItem>
  );
};
SaveToCloud.displayName = 'SaveToCloud';

export const NewCanvas = () => {
  const { t } = useI18n();
  const { onNewCanvas } = useDrawnix();

  if (!onNewCanvas) return null;

  return (
    <MenuItem
      data-testid="new-canvas-button"
      onSelect={onNewCanvas}
      icon={NewCanvasIcon}
      aria-label={t('menu.newCanvas')}
    >
      {t('menu.newCanvas')}
    </MenuItem>
  );
};
NewCanvas.displayName = 'NewCanvas';

export const OpenCanvas = () => {
  const { t } = useI18n();
  const { onOpenCanvas } = useDrawnix();

  if (!onOpenCanvas) return null;

  return (
    <MenuItem
      data-testid="open-canvas-button"
      onSelect={onOpenCanvas}
      icon={OpenFileIcon}
      aria-label={t('menu.openCanvas')}
    >
      {t('menu.openCanvas')}
    </MenuItem>
  );
};
OpenCanvas.displayName = 'OpenCanvas';

export const SaveAsImage = () => {
  const board = useBoard();
  const menuContentProps = useContext(MenuContentPropsContext);
  const { t } = useI18n();
  return (
    <MenuItem
      icon={ExportImageIcon}
      data-testid="image-export-button"
      onSelect={() => {
        saveAsImage(board, true);
      }}
      submenu={
        <Menu onSelect={() => {
          const itemSelectEvent = new CustomEvent(EVENT.MENU_ITEM_SELECT, {
            bubbles: true,
            cancelable: true,
          });
          menuContentProps.onSelect?.(itemSelectEvent);
        }}>
          <MenuItem
            onSelect={() => {
              saveAsSvg(board);
            }}
            aria-label={t('menu.exportImage.svg')}
          >
            {t('menu.exportImage.svg')}
          </MenuItem>
          <MenuItem
            onSelect={() => {
              saveAsImage(board, true);
            }}
            aria-label={t('menu.exportImage.png')}
          >
            {t('menu.exportImage.png')}
          </MenuItem>
          <MenuItem
            onSelect={() => {
              saveAsImage(board, false);
            }}
            aria-label={t('menu.exportImage.jpg')}
          >
            {t('menu.exportImage.jpg')}
          </MenuItem>
        </Menu>
      }
      shortcut={getShortcutKey('CtrlOrCmd+Shift+E')}
      aria-label={t('menu.exportImage')}
    >
      {t('menu.exportImage')}
    </MenuItem>
  );
};
SaveAsImage.displayName = 'SaveAsImage';

export const CleanBoard = () => {
  const { appState, setAppState } = useDrawnix();
  const { t } = useI18n();
  return (
    <MenuItem
      icon={TrashIcon}
      data-testid="reset-button"
      onSelect={() => {
        setAppState({
          ...appState,
          openCleanConfirm: true,
        });
      }}
      shortcut={getShortcutKey('CtrlOrCmd+Backspace')}
      aria-label={t('menu.cleanBoard')}
    >
      {t('menu.cleanBoard')}
    </MenuItem>
  );
};
CleanBoard.displayName = 'CleanBoard';

export const SignOut = () => {
  const { t } = useI18n();
  const { onSignOut } = useDrawnix();

  if (!onSignOut) return null;

  return (
    <MenuItem
      icon={SignOutIcon}
      onSelect={onSignOut}
      aria-label={t('menu.signOut')}
    >
      {t('menu.signOut')}
    </MenuItem>
  );
};
SignOut.displayName = 'SignOut';
