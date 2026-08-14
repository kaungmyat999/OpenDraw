import { PlaitNode } from '@plait/core';
import {
  getBranchColorByMindElement,
  getDefaultBranchColorByIndex,
  getMindThemeColor,
} from '@plait/mind';
import { adoptBranchColorOnMerge } from './mind-branch-color';

jest.mock('@plait/core', () => ({
  PlaitNode: { get: jest.fn() },
}));

jest.mock('@plait/layouts', () => ({
  AbstractNode: {
    isAbstract: (node: { start?: number }) => node.start !== undefined,
  },
}));

jest.mock('@plait/mind', () => ({
  getBranchColorByMindElement: jest.fn(),
  getDefaultBranchColorByIndex: jest.fn(),
  getMindThemeColor: jest.fn(),
}));

const PALETTE = ['#c0', '#c1', '#c2'];
const board = {} as never;

// Sibling colours are keyed off each sibling's own `color` field so tests can
// state the used palette directly.
const setUpBoard = (siblingColors: string[], slotColor: string) => {
  (PlaitNode.get as jest.Mock).mockReturnValue({
    children: siblingColors.map((color) => ({ color })),
  });
  (getBranchColorByMindElement as jest.Mock).mockImplementation(
    (_board, sibling: { color: string }) => sibling.color
  );
  (getDefaultBranchColorByIndex as jest.Mock).mockReturnValue(slotColor);
  (getMindThemeColor as jest.Mock).mockReturnValue({ branchColors: PALETTE });
};

describe('adoptBranchColorOnMerge', () => {
  beforeEach(() => jest.clearAllMocks());

  it('strips the styling a node carried while it was a root', () => {
    setUpBoard(['#c0'], '#c1');
    const node = {
      strokeColor: '#root',
      fill: '#rootfill',
      branchColor: '#old',
    } as never;

    adoptBranchColorOnMerge(board, node, [0, 1]);

    expect(node).toEqual({});
  });

  it('leaves the slot colour alone when no sibling is using it', () => {
    setUpBoard(['#c0', '#c1'], '#c2');
    const node = { strokeColor: '#root' } as never;

    adoptBranchColorOnMerge(board, node, [0, 2]);

    expect((node as { branchColor?: string }).branchColor).toBeUndefined();
  });

  it('pins the first unused palette colour when the slot colour collides', () => {
    setUpBoard(['#c0', '#c2'], '#c0');
    const node = { children: [{ children: [] }] } as never;

    adoptBranchColorOnMerge(board, node, [0, 3]);

    expect(node).toEqual({
      branchColor: '#c1',
      children: [{ branchColor: '#c1', children: [] }],
    });
  });

  it('keeps the slot colour when every palette colour is taken', () => {
    setUpBoard(PALETTE, '#c0');
    const node = {} as never;

    adoptBranchColorOnMerge(board, node, [0, 3]);

    expect((node as { branchColor?: string }).branchColor).toBeUndefined();
  });

  it('does not repaint abstract nodes or their subtrees', () => {
    setUpBoard(['#c0'], '#c0');
    const node = {
      children: [
        { start: 0, end: 1, children: [{ children: [] }] },
        { children: [] },
      ],
    } as never;

    adoptBranchColorOnMerge(board, node, [0, 1]);

    expect(node).toEqual({
      branchColor: '#c1',
      children: [
        { start: 0, end: 1, children: [{ children: [] }] },
        { branchColor: '#c1', children: [] },
      ],
    });
  });

  it('only clears styling for a node dropped below the first level', () => {
    setUpBoard(['#c0'], '#c0');
    const node = { strokeColor: '#root' } as never;

    adoptBranchColorOnMerge(board, node, [0, 1, 2]);

    expect(node).toEqual({});
    expect(PlaitNode.get).not.toHaveBeenCalled();
  });
});
