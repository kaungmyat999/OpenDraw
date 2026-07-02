import {
  PlaitBoard,
  PlaitElement,
  Point,
  Transforms,
  CoreTransforms,
} from '@plait/core';
import {
  MindElement,
  MindTransforms,
  PlaitMind,
  PlaitMindBoard,
  adjustNodeToRoot,
  copyNewNode,
  deleteElementsHandleRightNodeCount,
  getRectangleByNode,
  insertElementHandleRightNodeCount,
  isInRightBranchOfStandardLayout,
} from '@plait/mind';
import { AbstractNode } from '@plait/layouts';

// The mind package exports this only at runtime (no typings), so derive it
// directly from the element's children.
const getNonAbstractChildren = (element: MindElement): MindElement[] =>
  (element.children ?? []).filter(
    (child) => !AbstractNode.isAbstract(child)
  ) as MindElement[];

// Depth-first lookup of an element by id. Element identities are replaced on
// every transform, but ids are stable, so we re-resolve targets by id between
// mutations.
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

  // Promote `element`'s children (except those also being deleted) and remove
  // `element`.
  const promoteAndDelete = (element: MindElement, selectedIds: Set<string>) => {
    const children = getNonAbstractChildren(element).filter(
      (child) => !selectedIds.has(child.id)
    );

    if (PlaitMind.isMind(element)) {
      // Root: each child subtree becomes its own independent root mind map.
      const rooted = children.map((child) => {
        const rectangle = getRectangleByNode(MindElement.getNode(child));
        const copy = copyNewNode(child);
        const asRoot = adjustNodeToRoot(board as unknown as PlaitMindBoard, copy);
        asRoot.points = [[rectangle.x, rectangle.y] as Point];
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

    // Non-root: children move up to the deleted node's parent, taking the
    // deleted node's slot so they land on the same branch/side.
    const path = PlaitBoard.findPath(board, element);
    const index = path[path.length - 1];
    const parentPath = path.slice(0, -1);
    const wasRightBranch = isInRightBranchOfStandardLayout(element);
    const copies = children.map((child) => copyNewNode(child));

    // Keep the standard-layout root's rightNodeCount consistent: removing the
    // node drops one right child, inserting its children adds that many back.
    let refs = deleteElementsHandleRightNodeCount(board, [element]);
    if (wasRightBranch && copies.length > 0) {
      refs = insertElementHandleRightNodeCount(
        board,
        parentPath,
        copies.length,
        refs
      );
    }
    if (refs.length) {
      MindTransforms.setRightNodeCountByRefs(board, refs);
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
    const selectedIds = new Set(elements.map((element) => element.id));
    const promotableIds = elements
      .filter((element) => isPromotable(element, selectedIds))
      .map((element) => element.id);

    if (promotableIds.length === 0) {
      deleteFragment(elements);
      return;
    }

    // Promote + delete each parent-with-children individually so every step
    // runs against a consistent tree (re-resolving by id after each mutation).
    promotableIds.forEach((id) => {
      const element = findElementById(board.children, id);
      if (element && MindElement.isMindElement(board, element)) {
        promoteAndDelete(element, selectedIds);
      }
    });

    // Delete any remaining selected elements (leaf nodes, non-mind shapes) that
    // are still present, using the default behaviour.
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
