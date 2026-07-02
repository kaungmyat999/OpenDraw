import { PlaitBoard, PlaitOperation } from '@plait/core';
import { PlaitMind } from '@plait/mind';
import { MindLayoutType } from '@plait/layouts';

/**
 * Makes newly created mind maps two-sided: a fresh root is created by the mind
 * plugin with a single-sided `right` layout, which only shows the built-in
 * add ("+") button on the right. Switching a brand-new, empty root to the
 * `standard` layout makes the root grow children on both sides, so the built-in
 * add button appears on both the left and right of the root. Only the root is
 * affected; child nodes keep branching to a single side as usual.
 *
 * Existing maps are left alone: we only rewrite the insert of an empty root
 * (no children yet), so loading/pasting content with its own layout is
 * untouched.
 */
export const withStandardRoot = (board: PlaitBoard) => {
  const { apply } = board;

  board.apply = (operation: PlaitOperation) => {
    if (
      operation.type === 'insert_node' &&
      operation.path.length === 1 &&
      PlaitMind.isMind(operation.node) &&
      operation.node.layout === MindLayoutType.right &&
      (!operation.node.children || operation.node.children.length === 0)
    ) {
      // Mutate in-place to preserve the object identity that insertMind holds
      // and passes to addSelectionWithTemporaryElements after apply returns.
      // Cloning the node here would orphan that reference and break insertion.
      (operation.node as { layout: string }).layout = MindLayoutType.standard;
    }
    apply(operation);
  };

  return board;
};
