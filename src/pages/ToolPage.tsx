// Screen component for staging files, executing operations, and downloading results for PDF tools.
import { Suspense, createElement, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DropZone from '../components/DropZone';
import ImagePreviewModal from '../components/ImagePreviewModal';
import { useShell } from '../hooks/useShell';
import { useToast } from '../hooks/useToast';
import { useViewer } from '../hooks/useViewer';
import { useProcessing } from '../hooks/useProcessing';
import { getPlatformType, openPdfInNewTab, platform } from '../platform';
import type { OpenedFile } from '../platform';
import {
  getDefaultOutputBaseName,
  getOutputExtension,
  sanitizeOutputFileName,
} from '../tools/filename';
import { TOOLS, getToolById, getToolComponent, isToolImplemented } from '../tools/registry';
import type { StagedFile } from '../tools/types';
import StagedFileList from './tool/StagedFileList';
import ToolMissingState from './tool/ToolMissingState';
import ToolResultCard from './tool/ToolResultCard';
import ToolStatusCards from './tool/ToolStatusCards';
import ToolWebLayout from './tool/ToolWebLayout';
import { useFileReorder } from './tool/useFileReorder';

function getOperationMessage(toolId: string): string {
  switch (toolId) {
    case 'images-to-pdf':
      return 'Creating PDF…';
    case 'compress':
      return 'Compressing PDF…';
    case 'merge':
      return 'Merging PDFs…';
    case 'split':
      return 'Splitting PDF…';
    case 'rotate':
      return 'Rotating pages…';
    case 'remove-pages':
      return 'Removing pages…';
    default:
      return 'Processing PDF…';
  }
}

export default function ToolPage(): ReactNode {
  const { toolId } = useParams<{ toolId: string }>();
  const navigate = useNavigate();
  const { loadFile } = useViewer();
  const { shell } = useShell();
  const { showToast } = useToast();
  const { startProcessing, stopProcessing, runWithProcessing } = useProcessing();
  const activeImportReqRef = useRef<number | null>(null);

  const tool = getToolById(toolId || '');
  const isImplemented = tool ? isToolImplemented(tool.id) : false;

  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [optionsState, setOptionsState] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    tool?.options.forEach((opt) => {
      initial[opt.id] = opt.defaultValue;
    });
    return initial;
  });
  const [status, setStatus] = useState<'idle' | 'busy' | 'done'>('idle');
  const [outputBytes, setOutputBytes] = useState<Uint8Array | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [extraState, setExtraState] = useState<Record<string, unknown>>({});
  const [customFileName, setCustomFileName] = useState('');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const {
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
  } = useFileReorder({ stagedFiles, setStagedFiles });

  const defaultBaseName = useMemo(
    () => (tool ? getDefaultOutputBaseName(tool.id, stagedFiles) : 'document'),
    [tool, stagedFiles]
  );

  const outputExtension = useMemo(
    () => (tool ? getOutputExtension(tool.id, tool.outputName) : '.pdf'),
    [tool]
  );

  const acceptTypes = useMemo(() => {
    if (tool?.fileType === 'img') return 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
    if (tool?.fileType === 'txt') return '.txt,text/plain';
    return 'application/pdf,.pdf';
  }, [tool?.fileType]);

  const isZipOutput = outputExtension === '.zip';

  const resolvedBaseName = customFileName.trim() ? customFileName : defaultBaseName;
  const finalFileName = sanitizeOutputFileName(resolvedBaseName, defaultBaseName, outputExtension);

  const handleExtraStateChange = (key: string, value: unknown) => {
    setExtraState((prev) => ({ ...prev, [key]: value }));
  };

  // Lazily load the tool implementation module on demand
  const ToolComponent = tool ? getToolComponent(tool) : null;

  useEffect(() => {
    if (tool && !isImplemented) {
      showToast('Coming soon');
    }
  }, [tool, isImplemented, showToast]);

  if (!tool || !isImplemented) {
    return <ToolMissingState tool={tool} onNavigateHome={() => navigate('/')} />;
  }

  const handleFilesSelectedStart = (files: FileList | File[]) => {
    const isImageTool = tool?.id === 'images-to-pdf' || tool?.fileType === 'img';
    const message = isImageTool
      ? files.length > 1
        ? 'Importing photos…'
        : 'Preparing images…'
      : files.length > 1
      ? 'Importing files…'
      : 'Preparing file…';
    activeImportReqRef.current = startProcessing(message);
  };

  const handleFilesSelectedEnd = () => {
    if (activeImportReqRef.current !== null) {
      stopProcessing(activeImportReqRef.current);
      activeImportReqRef.current = null;
    }
  };

  const handleFilesAdded = (files: OpenedFile[]) => {
    handleFilesSelectedEnd();
    const newItems: StagedFile[] = files.map((f, i) => ({
      id: `${f.name}-${Date.now()}-${i}`,
      name: f.name,
      size: f.bytes.byteLength,
      bytes: f.bytes,
    }));
    setStagedFiles((prev) => [...prev, ...newItems]);
    setStatus('idle');
    setOutputBytes(null);
    setErrorMessage(null);
    setIsSaved(false);
    setExtraState({});
    setCustomFileName('');
    setPreviewIndex(null);
  };

  const handleRemoveFile = (id: string) => {
    setStagedFiles((prev) => prev.filter((f) => f.id !== id));
    setPreviewIndex(null);
  };

  const handleExecuteRunner = async (runner: () => Promise<Uint8Array>) => {
    setStatus('busy');
    setOutputBytes(null);
    setErrorMessage(null);
    setIsSaved(false);

    const message = tool ? getOperationMessage(tool.id) : 'Processing PDF…';

    try {
      const result = await runWithProcessing(message, runner);
      setOutputBytes(result);
      setStatus('done');
    } catch (err) {
      console.error('PDF tool processing failed:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Processing failed');
      setStatus('idle');
    }
  };

  const handleDownload = async () => {
    if (!outputBytes) return;
    try {
      const res = await platform.saveFile?.(
        outputBytes,
        finalFileName,
        isZipOutput ? 'application/zip' : 'application/pdf'
      );
      if (res && res.saved === false) {
        return;
      }
      const savedName = (res && res.fileName) || finalFileName;
      setIsSaved(true);
      showToast(`Saved ${savedName}`);
    } catch (err) {
      console.error('Failed to save file:', err);
      showToast('Failed to save file');
    }
  };

  const platformType = getPlatformType();

  const handleViewPdf = () => {
    if (!outputBytes) return;

    if (platformType === 'web') {
      const opened = openPdfInNewTab(outputBytes, finalFileName);
      if (!opened) {
        showToast('Pop-up was blocked. Please allow pop-ups for this site, or use Save PDF.');
      }
    } else {
      loadFile({
        name: finalFileName,
        bytes: outputBytes,
      });
      navigate('/viewer');
    }
  };

  const otherTools = TOOLS.filter((t) => t.id !== tool.id).slice(0, 8);

  const mainToolContent = (
    <>
      <ImagePreviewModal
        files={stagedFiles}
        currentIndex={previewIndex ?? 0}
        isOpen={previewIndex !== null}
        onClose={() => setPreviewIndex(null)}
        onNavigate={(idx) => setPreviewIndex(idx)}
      />

      <ToolStatusCards
        status={status}
        errorMessage={errorMessage}
        onClearError={() => setStatus('idle')}
      />

      {status === 'done' && outputBytes && (
        <ToolResultCard
          tool={tool}
          stagedFiles={stagedFiles}
          outputBytes={outputBytes}
          extraState={extraState}
          customFileName={customFileName}
          onCustomFileNameChange={setCustomFileName}
          defaultBaseName={defaultBaseName}
          outputExtension={outputExtension}
          isSaved={isSaved}
          isZipOutput={isZipOutput}
          platformType={platformType}
          onDownload={() => void handleDownload()}
          onViewPdf={() => void handleViewPdf()}
          onStartOver={() => {
            setStatus('idle');
            setOutputBytes(null);
          }}
          onClearFiles={() => {
            setStagedFiles([]);
            setStatus('idle');
            setOutputBytes(null);
            setErrorMessage(null);
            setIsSaved(false);
            setExtraState({});
            setCustomFileName('');
            setPreviewIndex(null);
          }}
        />
      )}

      {status === 'idle' && stagedFiles.length === 0 && (
        <DropZone
          title={tool.name}
          subtitle={tool.description}
          multiple={tool.id === 'merge' || tool.id === 'images-to-pdf'}
          accept={acceptTypes}
          onFilesSelectedStart={handleFilesSelectedStart}
          onFilesSelected={handleFilesAdded}
        />
      )}

      {status !== 'done' && stagedFiles.length > 0 && (
        <div className="tp">
          <div style={{ minWidth: 0, maxWidth: '100%', width: '100%' }}>
            <StagedFileList
              toolId={tool.id}
              stagedFiles={stagedFiles}
              draggedIndex={draggedIndex}
              dragOver={dragOver}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              onTouchStartGrip={handleTouchStartGrip}
              onTouchMoveGrip={handleTouchMoveGrip}
              onTouchEndGrip={handleTouchEndGrip}
              onGripKeyDown={handleGripKeyDown}
              onPreviewImage={setPreviewIndex}
              onMoveFile={handleMoveFile}
              onRemoveFile={handleRemoveFile}
            />

            <DropZone
              title="Add more files"
              subtitle="Choose additional files"
              ctaText="Add"
              multiple={true}
              accept={acceptTypes}
              onFilesSelectedStart={handleFilesSelectedStart}
              onFilesSelected={handleFilesAdded}
              className="add"
            />
          </div>

          <Suspense fallback={<div className="card opts"><div className="spin" /></div>}>
            {ToolComponent &&
              createElement(ToolComponent, {
                tool,
                stagedFiles,
                onFilesChange: setStagedFiles,
                optionsState,
                onOptionsChange: setOptionsState,
                onExecute: handleExecuteRunner,
                isProcessing: status === 'busy',
                extraState,
                onExtraStateChange: handleExtraStateChange,
                outputBaseName: customFileName,
                onOutputBaseNameChange: setCustomFileName,
                defaultBaseName,
                outputExtension,
              })}
          </Suspense>
        </div>
      )}
    </>
  );

  if (shell === 'web') {
    return (
      <ToolWebLayout
        toolName={tool.name}
        otherTools={otherTools}
        onComingSoonClick={(e: ReactMouseEvent) => {
          e.preventDefault();
          showToast('Coming soon');
        }}
      >
        {mainToolContent}
      </ToolWebLayout>
    );
  }

  return <div className="cnt">{mainToolContent}</div>;
}
