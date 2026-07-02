import {
  PlaitBoard,
  PlaitElement,
  Point,
  Transforms,
  CoreTransforms,
  getSelectedElements,
} from '@plait/core';
import {
  MindElement,
  MindTransforms,
  PlaitMind,
  PlaitMindBoard,
  adjustNodeToRoot,
  copyNewNode,
  getRectangleByNode,
  insertElementHandleRightNodeCount,
  isInRightBranchOfStandardLayout,
} from '@plait/mind';
import { AbstractNode } from '@plait/layouts';

const getNonAbstractChildren = (element: MindElement): MindElement[] =>
  (element.children ?? []).filter(
    (child) => !AbstractNode.isAbstract(child)
  ) as MindElement[];

const findElementById = (
  nodes: PlaitElement[],
  id: string
): PlaitElement | undefined => {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    if (Array.isArray(node.children)) {
      const found = findElementById(node.children as PlaitElement[], id);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
};

/**
 * Overrides delete so that removing a parent node (including the root/main node)
 * does not throw away its subtree. Instead the deleted node's direct children
 * are promoted:
 *  - deleting the root -> each child (with its own subtree) becomes a new,
 *    independent root mind map, kept at its current position;
 *  - deleting any other parent -> its children move up to become children of
 *    the deleted node's parent, on the same branch/side.
 * Childless nodes and non-mind elements are deleted normally.
 */
export const withMindDeletePromote = (board: PlaitBoard) => {
  const { deleteFragment } = board;

  // A node is promotable only if it has at least one child that is NOT itself
  // being deleted. When everything is selected (e.g. select-all + delete) every
  // child is in `selectedIds`, so nothing is promoted and the whole selection
  // is deleted normally.
  const isPromotable = (
    element: PlaitElement,
    selectedIds: Set<string>
  ): boolean =>
    MindElement.isMindElement(board, element) &&
    !AbstractNode.isAbstract(element as MindElement) &&
    getNonAbstractChildren(element as MindElement).some(
      (child) => !selectedIds.has(child.id)
    );

  const promoteAndDelete = (element: MindElement, selectedIds: Set<string>) => {
    const children = getNonAbstractChildren(element).filter(
      (child) => !selectedIds.has(child.id)
    );

    if (PlaitMind.isMind(element)) {
      // Root: each surviving child subtree becomes its own independent root.
      // Position the new root at the child's current canvas location.
      // Fall back to the old root's position if the layout node is unavailable.
      const [fallbackX, fallbackY] = (element as PlaitElement & { points: Point[] }).points?.[0] ?? [0, 0];
      const rooted = children.map((child, index) => {
        let x = fallbackX + (index + 1) * 30;
        let y = fallbackY + index * 60;
        try {
          const rect = getRectangleByNode(MindElement.getNode(child));
          x = rect.x;
          y = rect.y;
        } catch {
          // child layout node not yet computed — use staggered fallback position
        }
        const copy = copyNewNode(child);
        const asRoot = adjustNodeToRoot(board as unknown as PlaitMindBoard, copy);
        asRoot.points = [[x, y] as Point];
        return asRoot;
      });
      CoreTransforms.removeElements(board, [element]);
      rooted.forEach((root) => {
        Transforms.insertNode(board, root, [board.children.length]);
      });
      if (rooted.length) {
        Transforms.addSelectionWithTemporaryElements(board, rooted);
      }
      return;
    }

    // Non-root: children move up to the deleted node's parent at the same slot.
    //
    // Note: withMindExtend's getDeletedFragment already decremented the parent's
    // rightNodeCount by 1 (for the node being removed). We must NOT call
    // deleteElementsHandleRightNodeCount again — that would double-decrement.
    // We only need to account for the extra children being inserted.
    const path = PlaitBoard.findPath(board, element);
    const index = path[path.length - 1];
    const parentPath = path.slice(0, -1);
    const wasRightBranch = isInRightBranchOfStandardLayout(element);
    const copies = children.map((child) => copyNewNode(child));

    // getDeletedFragment subtracted 1 for the removed node. Each additional
    // child inserted on the right side needs +1 in rightNodeCount.
    if (wasRightBranch && copies.length > 1) {
      const refs = insertElementHandleRightNodeCount(
        board,
        parentPath,
        copies.length - 1,
        []
      );
      if (refs.length) {
        MindTransforms.setRightNodeCountByRefs(board, refs);
      }
    }

    CoreTransforms.removeElements(board, [element]);
    copies.forEach((copy, i) => {
      Transforms.insertNode(board, copy, [...parentPath, index + i]);
    });
    if (copies.length) {
      Transforms.addSelectionWithTemporaryElements(board, copies);
    }
  };

  board.deleteFragment = (elements: PlaitElement[]) => {
    // getDeletedFragment filters to first-level elements before calling here,
    // so `elements` only contains ancestor nodes (e.g. [c1]) even when c1's
    // descendants are also selected. Read the full selection so that
    // isPromotable correctly sees the descendants as "being deleted" and skips
    // promoting them.
    const allSelected = getSelectedElements(board);
    const selectedIds = new Set([
      ...allSelected.map((e) => e.id),
      ...elements.map((e) => e.id),
    ]);
    const promotableIds = elements
      .filter((element) => isPromotable(element, selectedIds))
      .map((element) => element.id);

    if (promotableIds.length === 0) {
      deleteFragment(elements);
      return;
    }

    promotableIds.forEach((id) => {
      const element = findElementById(board.children, id);
      if (element && MindElement.isMindElement(board, element)) {
        promoteAndDelete(element, selectedIds);
      }
    });

    const remaining = elements
      .filter((element) => !promotableIds.includes(element.id))
      .map((element) => findElementById(board.children, element.id))
      .filter((element): element is PlaitElement => !!element);
    if (remaining.length) {
      deleteFragment(remaining);
    }
  };

  return board;
};
