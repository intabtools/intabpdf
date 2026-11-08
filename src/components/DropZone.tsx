import { useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { FileText, Plus } from 'lucide-react';
import type { OpenedFile } from '../platform';
import { validateFileSelectionCount } from './dropZoneValidation';

interface DropZoneProps {
  title?: string;
  subtitle?: string;
  ctaText?: string;
  accept?: string;
  multiple?: boolean;
  onFilesSelected?: (files: OpenedFile[]) => void;
  onFilesSelectedStart?: (files: FileList | File[]) => void;
  onMultipleRejected?: (count: number) => void;
  className?: string;
}

export default function DropZone({
  title = 'Open PDF files',
  subtitle = 'Choose files or drop them here.',
  ctaText = 'Choose files',
  accept = 'application/pdf,.pdf',
  multiple = false,
  onFilesSelected,
  onFilesSelectedStart,
  onMultipleRejected,
  className = '',
}: DropZoneProps): ReactNode {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFileList = async (fileList: FileList | File[] | null) => {
    if (!fileList || fileList.length === 0 || !onFilesSelected) {
      return;
    }
    // Yield to the event loop so the browser paints the loading screen immediately
    await new Promise((resolve) => setTimeout(resolve, 0));
    const openedFiles: OpenedFile[] = [];

    if (!validateFileSelectionCount(fileList.length, multiple, onMultipleRejected)) {
      return;
    }

    try {
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        try {
          const buffer = await file.arrayBuffer();
          openedFiles.push({
            name: file.name,
            bytes: new Uint8Array(buffer),
          });
        } catch (err) {
          console.error(`Failed to read file ${file.name}:`, err);
        }
      }

      if (openedFiles.length > 0) {
        onFilesSelected(openedFiles);
      } else {
        onFilesSelected([]);
      }
    } catch (err) {
      console.error('Failed to process file list:', err);
      onFilesSelected([]);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleDragOver = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const rawFiles = e.dataTransfer.files;
    if (!rawFiles || rawFiles.length === 0) return;

    if (!validateFileSelectionCount(rawFiles.length, multiple, onMultipleRejected)) {
      return;
    }

    onFilesSelectedStart?.(rawFiles);
    void processFileList(rawFiles);
  };

  return (
    <button
      type="button"
      className={`dz ${isDragging ? 'drag' : ''} ${className}`}
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = e.target.files;
          if (!files || files.length === 0) return;

          if (!validateFileSelectionCount(files.length, multiple, onMultipleRejected)) {
            e.target.value = '';
            return;
          }

          onFilesSelectedStart?.(files);
          void processFileList(files);
          e.target.value = '';
        }}
      />
      <span className="di">
        <FileText size={22} />
        <u><Plus size={11} strokeWidth={2.5} /></u>
      </span>
      <span className="dt">
        <b>{title}</b>
        <small>{subtitle}</small>
      </span>
      <span className="go">{ctaText}</span>
    </button>
  );
}
