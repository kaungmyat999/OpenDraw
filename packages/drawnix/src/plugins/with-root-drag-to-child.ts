import {
  CoreTransforms,
  PlaitBoard,
  PlaitElement,
  PlaitNode,
  PlaitPointerType,
  Transforms,
  createG,
  depthFirstRecursion,
  distanceBetweenPointAndPoint,
  getIsRecursionFunc,
  getSelectedElements,
  isMainPointer,
  toHostPoint,
  toViewBoxPoint,
} from '@plait/core';
import {
  MindElement,
  MindTransforms,
  PlaitMind,
  PlaitMindBoard,
  adjustRootToNode,
  deleteElementsHandleRightNodeCount,
  detectDropTarget,
  drawFakeDragNode,
  drawFakeDropNode,
  getPathByDropTarget,
  insertElementHandleRightNodeCount,
  isDropStandardRight,
  setMindDragging,
} from '@plait/mind';
import { Path } from '@plait/core';
import { clearMindTopicSizeCache } from '../utils/mind-topic-size';
import { adoptBranchColorOnMerge } from '../utils/mind-branch-color';

const DRAG_MOVE_BUFFER = 5;

/**
 * Overrides Plait's mind-drag guard (`!PlaitMind.isMind(hitElement)`) so that
 * root nodes can participate in the standard mind drag-to-connect flow.
 *
 * The implementation mirrors withNodeDnd from @plait/mind, but activates when
 * the clicked element IS a root (PlaitMind.isMind === true). On drop:
 *  - The root is converted to a mind_child via adjustRootToNode.
 *  - Its children (and their subtrees) are preserved as-is.
 *  - Left/right branch placement is determined by detectDropTarget, exactly
 *    as it would be for a regular child node drag.
 */
export const withRootDragToChild = (board: PlaitBoard) => {
  const { pointerDown, pointerMove, globalPointerUp } = board;

  let activeRoot: PlaitElement | null = null;
  let startPoint: [number, number] | null = null;
  let dropTarget: ReturnType<typeof detectDropTarget> = null;
  let targetPath: number[] | null = null;
  let dragFakeNodeG: SVGGElement | null = null;
  let fakeDropNodeG: SVGGElement | null = null;

  board.pointerDown = (event: PointerEvent) => {
    if (
      !PlaitBoard.isReadonly(board) &&
      PlaitBoard.isPointer(board, PlaitPointerType.selection) &&
      isMainPointer(event)
    ) {
      const point = toViewBoxPoint(board, toHostPoint(board, event.x, event.y));
      const selectedElements = getSelectedElements(board);
      const hitElement = selectedElements.find(
        (e) =>
          PlaitMind.isMind(e) &&
          MindElement.isMindElement(board, e)
      );
      // Only activate our drag when the user clicks a root that is already
      // selected (same contract as withNodeDnd for child nodes).
      if (hitElement) {
        activeRoot = hitElement;
        startPoint = point as [number, number];
      }
    }
    pointerDown(event);
  };

  board.pointerMove = (event: PointerEvent) => {
    if (activeRoot && startPoint) {
      const endPoint = toViewBoxPoint(board, toHostPoint(board, event.x, event.y)) as [number, number];
      const distance = distanceBetweenPointAndPoint(startPoint[0], startPoint[1], endPoint[0], endPoint[1]);
      if (distance < DRAG_MOVE_BUFFER) {
        pointerMove(event);
        return;
      }

      // Activate mind dragging — this prevents the board from showing a
      // selection rectangle and suppresses other pointer-move handlers.
      setMindDragging(board, true);

      fakeDropNodeG?.remove();
      const detectPoint = toViewBoxPoint(board, toHostPoint(board, event.x, event.y)) as [number, number];
      dropTarget = detectDropTarget(board, detectPoint, dropTarget, [activeRoot]);
      if (dropTarget?.target) {
        targetPath = getPathByDropTarget(board, dropTarget);
        fakeDropNodeG = drawFakeDropNode(board, dropTarget, targetPath);
        PlaitBoard.getHost(board).appendChild(fakeDropNodeG);
      } else {
        targetPath = null;
      }

      const offsetX = endPoint[0] - startPoint[0];
      const offsetY = endPoint[1] - startPoint[1];
      dragFakeNodeG?.remove();
      dragFakeNodeG = createG();
      const nodeG = drawFakeDragNode(board, activeRoot as Parameters<typeof drawFakeDragNode>[1], offsetX, offsetY);
      dragFakeNodeG.appendChild(nodeG);
      PlaitBoard.getHost(board).appendChild(dragFakeNodeG);

      // Return early — do NOT propagate to board movement or inner plugins,
      // exactly as withNodeDnd does when its own activeElements are set.
      return;
    }
    pointerMove(event);
  };

  board.globalPointerUp = (event: PointerEvent) => {
    const root = activeRoot;
    const path = targetPath;
    const target = dropTarget;

    // Reset all drag state before calling the chain so inner handlers don't
    // see stale drag state from us.
    activeRoot = null;
    startPoint = null;
    dropTarget = null;
    targetPath = null;
    dragFakeNodeG?.remove();
    dragFakeNodeG = null;
    fakeDropNodeG?.remove();
    fakeDropNodeG = null;

    if (root && path && target) {
      // Use a pathRef so the insert path stays correct after the remove.
      const targetPathRef = board.pathRef(path);
      const targetPreviousPathRef =
        Path.hasPrevious(path) ? board.pathRef(Path.previous(path)) : null;
      const targetElementPathRef = board.pathRef(
        PlaitBoard.findPath(board, target.target)
      );

      // Adjust rightNodeCount for the source side (roots are top-level so
      // this is a no-op, but kept for symmetry with withNodeDnd).
      let refs = deleteElementsHandleRightNodeCount(board, [root]);

      // If dropping onto the right branch of a standard root, increment
      // that root's rightNodeCount to claim the right-branch slot.
      const parent = PlaitNode.get(board, Path.parent(path));
      const shouldInsertRight = isDropStandardRight(
        parent as Parameters<typeof isDropStandardRight>[0],
        target as Parameters<typeof isDropStandardRight>[1]
      );
      if (shouldInsertRight && targetElementPathRef.current) {
        refs = insertElementHandleRightNodeCount(
          board,
          targetElementPathRef.current.slice(0, 1),
          1,
          refs
        );
      }
      MindTransforms.setRightNodeCountByRefs(board, refs);

      // Convert root → child node (strips rightNodeCount, layout:standard, type).
      const childNode = adjustRootToNode(
        board as unknown as PlaitMindBoard,
        root as Parameters<typeof adjustRootToNode>[1]
      );
      clearMindTopicSizeCache(board, childNode);

      // Remove the root from the board first.
      CoreTransforms.removeElements(board, [root]);

      // Re-resolve insert path (removal may have shifted indices).
      let insertPath = targetPathRef.current;
      if (!insertPath) {
        const previousPath = targetPreviousPathRef?.unref();
        if (previousPath) {
          insertPath = Path.next(previousPath);
        } else {
          const parentEl = PlaitNode.get(board, Path.parent(path));
          const childCount = ((parentEl as any).children ?? []).length;
          insertPath = [...Path.parent(path), childCount];
        }
      }

      // Must run before the insert, while the target root still lists only its
      // pre-existing children, so their colours are what we compare against.
      adoptBranchColorOnMerge(board, childNode, insertPath);

      Transforms.insertNode(board, childNode, insertPath);
      Transforms.addSelectionWithTemporaryElements(board, [childNode]);

      targetPathRef.unref();
      targetPreviousPathRef?.unref();
      targetElementPathRef.unref();

      setMindDragging(board, false);
    }

    globalPointerUp(event);
  };

  return board;
};
