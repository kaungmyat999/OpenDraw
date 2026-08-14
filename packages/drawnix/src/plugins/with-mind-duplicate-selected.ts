import {
  getSelectedElements,
  PlaitBoard,
  PlaitElement,
  RectangleClient,
  WritableClipboardContext,
  WritableClipboardOperationType,
} from '@plait/core';
import { MindElement, PlaitMind } from '@plait/mind';
import { AbstractNode } from '@plait/layouts';

/**
 * Makes duplicate (Cmd/Ctrl+D) respect the selection inside mind maps.
 *
 * Plait's mind fragment builder reduces the selection to its topmost nodes and
 * copies each with its ENTIRE subtree, so with `root -> a -> b -> c` selecting
 * `a` and `b` duplicates `a -> b -> c`. This plugin prunes the duplicated
 * fragment so a copied node keeps a child only if that child was selected too
 * (strict prune — unselected descendants are cut off, and a selected node whose
 * parent chain is not fully selected is dropped with it).
 *
 * Collapsed nodes keep their hidden subtree: those children cannot be selected,
 * so pruning them would make duplicating a collapsed branch impossible.
 *
 * Only the duplicate operation is affected; copy/cut fragments are left alone
 * (pruning a cut would silently destroy the unselected descendants).
 */
export const withMindDuplicateSelected = (board: PlaitBoard) => {
  const { buildFragment } = board;

  board.buildFragment = (
    clipboardContext: WritableClipboardContext | null,
    rectangle: RectangleClient | null,
    operationType: WritableClipboardOperationType,
    originData?: PlaitElement[]
  ) => {
    const context = buildFragment(
      clipboardContext,
      rectangle,
      operationType,
      originData
    );
    if (
      operationType !== WritableClipboardOperationType.duplicate ||
      !context?.elements?.length
    ) {
      return context;
    }
    const selected = originData?.length
      ? originData
      : getSelectedElements(board);
    const selectedIds = new Set(selected.map((element) => element.id));

    // The fragment shares node objects with the live board, so pruning must
    // build new objects instead of mutating children in place.
    const prune = (node: MindElement): MindElement => {
      if (node.isCollapsed) {
        return node;
      }
      const children = (node.children ?? []) as MindElement[];
      const normal = children.filter((child) => !AbstractNode.isAbstract(child));
      const kept = normal.filter((child) => selectedIds.has(child.id));
      // Abstract (summary) nodes reference sibling index ranges; they only stay
      // valid when no sibling was pruned.
      const abstracts =
        kept.length === normal.length
          ? children.filter(
              (child) =>
                AbstractNode.isAbstract(child) && selectedIds.has(child.id)
            )
          : [];
      const next: MindElement = {
        ...node,
        children: [...kept, ...abstracts].map(prune),
      };
      if (PlaitMind.isMind(next)) {
        next.rightNodeCount = Math.min(
          next.rightNodeCount ?? 0,
          next.children.length
        );
      }
      return next;
    };

    context.elements = context.elements.map((element) =>
      MindElement.isMindElement(board, element)
        ? prune(element as MindElement)
        : element
    );
    return context;
  };

  return board;
};
