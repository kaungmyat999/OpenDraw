import React, { useState } from 'react';
import { PlaitBoard } from '@plait/core';
import { Select } from '../../select/select';
import { LineHeightIcon } from '../../icons';
import { setTextLineHeight } from '../../../transforms/property';

export type PopupLineHeightControlProps = {
  board: PlaitBoard;
  currentLineHeight?: number;
  title: string;
};

// 1.5 is the library default (plait renders and measures text at 1.5em), so
// picking it clears the stored property instead of pinning a value.
const DEFAULT_LINE_HEIGHT = 1.5;
const OPTIONS = [1, 1.15, 1.5, 2, 2.5, 3];

export const PopupLineHeightControl: React.FC<PopupLineHeightControlProps> = ({
  board,
  currentLineHeight,
  title,
}) => {
  const [open, setOpen] = useState(false);
  const container = PlaitBoard.getBoardContainer(board);
  const value =
    typeof currentLineHeight === 'number' && Number.isFinite(currentLineHeight)
      ? currentLineHeight
      : DEFAULT_LINE_HEIGHT;

  return (
    <Select.Root
      open={open}
      onOpenChange={setOpen}
      placement={'top-start'}
      sideOffset={12}
      hideSelectedIndicator
      disableInitialHighlight
      disableItemHoverHighlight
      disableTypeahead
    >
      <Select.Trigger asChild>
        <div
          className="popup-line-height"
          title={title}
          aria-label={title}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onPointerUp={(event) => {
            event.stopPropagation();
            setOpen(!open);
          }}
        >
          {/* createIcon returns a node, not a component — render it directly
              and let the wrapper carry the sizing class. */}
          <span className="popup-line-height__icon" aria-hidden="true">
            {LineHeightIcon}
          </span>
          <span className="popup-line-height__value">{value}</span>
        </div>
      </Select.Trigger>
      <Select.Content
        container={container}
        style={{ minWidth: '4.5rem' }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
        }}
      >
        {OPTIONS.map((option) => {
          const optionValue = String(option);
          return (
            <Select.Item
              key={optionValue}
              value={optionValue}
              textValue={optionValue}
              onPointerUp={() => {
                setTextLineHeight(
                  board,
                  option === DEFAULT_LINE_HEIGHT ? null : option
                );
                setOpen(false);
              }}
            >
              {optionValue}
            </Select.Item>
          );
        })}
      </Select.Content>
    </Select.Root>
  );
};
