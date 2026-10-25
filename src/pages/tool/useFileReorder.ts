// Custom hook encapsulating drag-and-drop, touch reordering, and keyboard navigation for staged files.
import { useRef, useState } from 'react';
import type { Dispatch, DragEvent, KeyboardEvent as ReactKeyboardEvent, SetStateAction, TouchEvent } from 'react';
import { calculateDropIndex, reorderItems } from '../../tools/reorder';
import type { StagedFile } from '../../tools/types';

interface UseFileReorderOptions {
  stagedFiles: StagedFile[];
  setStagedFiles: Dispatch<SetStateAction<StagedFile[]>>;
}

export function useFileReorder({
  stagedFiles,
  setStagedFiles,
}: UseFileReorderOptions) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<{ index: number; position: 'before' | 'after' } | null>(
    null
  );
  const touchDragRef = useRef<{ startIndex: number } | null>(null);

  const handleMoveFile = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    setStagedFiles((prev) => reorderItems(prev, index, targetIndex));
  };

  const handleDragStart = (e: DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    setDraggedIndex(index);
  };

  const handleDragOver = (e: DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position = e.clientY < midY ? 'before' : 'after';
    setDragOver({ index, position });
  };

  const handleDragLeave = (e: DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (!e.currentTarget.contains(related)) {
      setDragOver(null);
    }
  };

  const handleDrop = (e: DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null) return;
    const position = dragOver?.position ?? 'after';
    const destinationIndex = calculateDropIndex(draggedIndex, targetIndex, position);
    if (destinationIndex !== draggedIndex) {
      setStagedFiles((prev) => reorderItems(prev, draggedIndex, destinationIndex));
    }
    setDraggedIndex(null);
    setDragOver(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOver(null);
  };

  const handleTouchStartGrip = (_e: TouchEvent, index: number) => {
    touchDragRef.current = { startIndex: index };
    setDraggedIndex(index);
  };

  const handleTouchMoveGrip = (e: TouchEvent) => {
    if (!touchDragRef.current) return;
    const touch = e.touches[0];
    const elem = document.elementFromPoint(touch.clientX, touch.clientY);
    const card = elem?.closest('[data-staged-index]');
    if (card) {
      const targetIdx = parseInt(card.getAttribute('data-staged-index')!, 10);
      if (!isNaN(targetIdx)) {
        const rect = card.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const position = touch.clientY < midY ? 'before' : 'after';
        setDragOver({ index: targetIdx, position });
      }
    }
  };

  const handleTouchEndGrip = () => {
    if (touchDragRef.current && dragOver) {
      const fromIdx = touchDragRef.current.startIndex;
      const destIdx = calculateDropIndex(fromIdx, dragOver.index, dragOver.position);
      if (destIdx !== fromIdx) {
        setStagedFiles((prev) => reorderItems(prev, fromIdx, destIdx));
      }
    }
    touchDragRef.current = null;
    setDraggedIndex(null);
    setDragOver(null);
  };

  const handleGripKeyDown = (e: ReactKeyboardEvent, index: number) => {
    if (e.key === 'ArrowUp' || (e.altKey && e.key === 'ArrowUp')) {
      e.preventDefault();
      if (index > 0) {
        handleMoveFile(index, 'up');
      }
    } else if (e.key === 'ArrowDown' || (e.altKey && e.key === 'ArrowDown')) {
      e.preventDefault();
      if (index < stagedFiles.length - 1) {
        handleMoveFile(index, 'down');
      }
    }
  };

  return {
    draggedIndex,
    dragOver,
    handleMoveFile,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    handleTouchStartGrip,
    handleTouchMoveGrip,
    handleTouchEndGrip,
    handleGripKeyDown,
  };
}
