import React from 'react';
import { ToolButton } from '../../tool-button';
import classNames from 'classnames';
import { useI18n } from '../../../i18n';
import {
  CoreTransforms,
  PlaitBoard,
  Transforms,
  canAddGroup,
  canRemoveGroup,
  deleteFragment,
  duplicateElements,
  getRectangleByElements,
  getSelectedElements,
} from '@plait/core';
import {
  DetachIcon,
  DuplicateIcon,
  GroupIcon,
  MergeIcon,
  MoreOptionsIcon,
  TrashIcon,
  UngroupIcon,
} from '../../icons';
import { Popover, PopoverContent, PopoverTrigger } from '../../popover/popover';
import Menu from '../../menu/menu';
import MenuItem from '../../menu/menu-item';
import { useState } from 'react';
import { getShortcutKey } from '../../../utils/common';
import {
  canCopySelectionAs,
  copySelectionAsPng,
  copySelectionAsSvg,
} from '../../../utils/image';
import {
  MindElement,
  MindTransforms,
  PlaitMind,
  PlaitMindBoard,
  adjustNodeToRoot,
  canSetAbstract,
  deleteElementHandleAbstract,
  deleteElementsHandleRightNodeCount,
} from '@plait/mind';
import { AbstractNode } from '@plait/layouts';

const detachMindChildren = (board: PlaitBoard) => {
  const selected = getSelectedElements(board).filter(
    (e) =>
      MindElement.isMindElement(board, e) &&
      !PlaitMind.isMind(e) &&
      !AbstractNode.isAbstract(e as Parameters<typeof AbstractNode.isAbstract>[0])
  );

  for (const element of selected) {
    const rect = getRectangleByElements(board, [element], false);
    const position: [number, number] = [rect.x, rect.y];

    const refs = deleteElementsHandleRightNodeCount(board, [element]);
    const abstractRefs = deleteElementHandleAbstract(board, [element]);
    MindTransforms.setAbstractsByRefs(board, abstractRefs);
    MindTransforms.setRightNodeCountByRefs(board, refs);

    CoreTransforms.removeElements(board, [element]);

    const rootNode = adjustNodeToRoot(
      board as unknown as PlaitMindBoard,
      element as Parameters<typeof adjustNodeToRoot>[1]
    );
    (rootNode as { points: [number, number][] }).points = [position];

    Transforms.insertNode(board, rootNode, [board.children.length]);
    Transforms.addSelectionWithTemporaryElements(board, [rootNode]);
  }
};

/**
 * Merge (a, b, c) -> d: wraps the selected sibling nodes with a summary
 * bracket and creates a single node they all converge into. Backed by
 * Plait's abstract/summary node, so the merged node follows layout changes
 * and its range can be resized with the built-in handles.
 */
const getMergeableElements = (board: PlaitBoard) =>
  getSelectedElements(board).filter(
    (e) => MindElement.isMindElement(board, e) && canSetAbstract(e)
  ) as MindElement[];

const canMerge = (board: PlaitBoard) => {
  const selected = getSelectedElements(board);
  return selected.length >= 2 && getMergeableElements(board).length === selected.length;
};

const mergeSelectedNodes = (board: PlaitBoard) => {
  MindTransforms.insertAbstract(board, getMergeableElements(board));
};

const canDetach = (board: PlaitBoard) =>
  getSelectedElements(board).some(
    (e) =>
      MindElement.isMindElement(board, e) &&
      !PlaitMind.isMind(e) &&
      !AbstractNode.isAbstract(e as Parameters<typeof AbstractNode.isAbstract>[0])
  );

export type MoreOptionsButtonProps = {
  board: PlaitBoard;
};

export const MoreOptionsButton: React.FC<MoreOptionsButtonProps> = ({
  board,
}) => {
  const { t } = useI18n();
  const container = PlaitBoard.getBoardContainer(board);
  const [menuOpen, setMenuOpen] = useState(false);
  const canCopySvg = canCopySelectionAs('svg');
  const canCopyPng = canCopySelectionAs('png');
  const canCopyAny = canCopySvg || canCopyPng;
  const showDetach = canDetach(board);
  const showMerge = canMerge(board);
  // Grouping itself is plait's (withGroup + Transforms.addGroup/removeGroup);
  // these entries just surface it, since the mod+g / mod+shift+g hotkeys it
  // registers are otherwise undiscoverable.
  const showGroup = canAddGroup(board);
  const showUngroup = canRemoveGroup(board);

  return (
    <Popover
      sideOffset={12}
      open={menuOpen}
      onOpenChange={(open) => {
        setMenuOpen(open);
      }}
      placement="bottom-start"
    >
      <PopoverTrigger asChild>
        <ToolButton
          className={classNames('property-button')}
          visible={true}
          selected={menuOpen}
          icon={MoreOptionsIcon}
          type="icon"
          title={t('general.moreOptions')}
          aria-label={t('general.moreOptions')}
          onPointerDown={() => {
            setMenuOpen(!menuOpen);
          }}
        />
      </PopoverTrigger>
      <PopoverContent container={container}>
        <Menu
          className={classNames('popup-toolbar-more-options-menu')}
          onSelect={() => {
            setMenuOpen(false);
          }}
        >
          {showMerge && (
            <MenuItem
              onSelect={() => {
                mergeSelectedNodes(board);
                setMenuOpen(false);
              }}
              icon={MergeIcon}
              aria-label={t('mind.merge')}
            >
              {t('mind.merge')}
            </MenuItem>
          )}
          {showDetach && (
            <MenuItem
              onSelect={() => {
                detachMindChildren(board);
                setMenuOpen(false);
              }}
              icon={DetachIcon}
              aria-label={t('mind.detach')}
            >
              {t('mind.detach')}
            </MenuItem>
          )}
          {showGroup && (
            <MenuItem
              onSelect={() => {
                Transforms.addGroup(board);
                setMenuOpen(false);
              }}
              icon={GroupIcon}
              shortcut={getShortcutKey('CtrlOrCmd+G')}
              aria-label={t('general.group')}
            >
              {t('general.group')}
            </MenuItem>
          )}
          {showUngroup && (
            <MenuItem
              onSelect={() => {
                Transforms.removeGroup(board);
                setMenuOpen(false);
              }}
              icon={UngroupIcon}
              shortcut={getShortcutKey('CtrlOrCmd+Shift+G')}
              aria-label={t('general.ungroup')}
            >
              {t('general.ungroup')}
            </MenuItem>
          )}
          <MenuItem
            onSelect={() => {
              duplicateElements(board);
            }}
            icon={DuplicateIcon}
            shortcut={getShortcutKey('CtrlOrCmd+D')}
            aria-label={t('general.duplicate')}
          >
            {t('general.duplicate')}
          </MenuItem>
          <MenuItem
            onSelect={() => {
              deleteFragment(board);
            }}
            icon={TrashIcon}
            shortcut={getShortcutKey('Backspace')}
            aria-label={t('general.delete')}
          >
            {t('general.delete')}
          </MenuItem>
          <MenuItem
            onSelect={() => undefined}
            aria-label={t('general.copyToClipboard')}
            disabled={!canCopyAny}
            submenu={
              <Menu
                onSelect={() => {
                  setMenuOpen(false);
                }}
              >
                <MenuItem
                  onSelect={() => {
                    void copySelectionAsSvg(board).catch(() => undefined);
                  }}
                  disabled={!canCopySvg}
                  aria-label={t('general.copyToClipboard.svg')}
                >
                  {t('general.copyToClipboard.svg')}
                </MenuItem>
                <MenuItem
                  onSelect={() => {
                    void copySelectionAsPng(board).catch(() => undefined);
                  }}
                  disabled={!canCopyPng}
                  aria-label={t('general.copyToClipboard.pngWithoutBackground')}
                >
                  {t('general.copyToClipboard.pngWithoutBackground')}
                </MenuItem>
                <MenuItem
                  onSelect={() => {
                    void copySelectionAsPng(board, true).catch(() => undefined);
                  }}
                  disabled={!canCopyPng}
                  aria-label={t('general.copyToClipboard.pngWithBackground')}
                >
                  {t('general.copyToClipboard.pngWithBackground')}
                </MenuItem>
              </Menu>
            }
          >
            {t('general.copyToClipboard')}
          </MenuItem>
        </Menu>
      </PopoverContent>
    </Popover>
  );
};
