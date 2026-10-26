// Shared tool definitions and worker types
import type { ComponentType } from 'react';

export interface ToolOption {
  id: string;
  label: string;
  description: string;
  defaultValue: boolean;
}

export type ToolCategory =
  | 'Create'
  | 'Organize'
  | 'Shrink and secure'
  | 'Sign and convert';

export type ToolFileType = 'pdf' | 'img' | 'txt';

export type ToolAvailability = 'available' | 'coming-soon';

export interface StagedFile {
  id: string;
  name: string;
  size: number;
  bytes: Uint8Array;
}

export interface ToolExecutionPayload {
  tool: ToolDefinition;
  files: StagedFile[];
  options: Record<string, boolean>;
  extra?: Record<string, unknown>;
}

export interface ToolComponentProps {
  tool: ToolDefinition;
  stagedFiles: StagedFile[];
  onFilesChange?: (files: StagedFile[]) => void;
  optionsState: Record<string, boolean>;
  onOptionsChange: (options: Record<string, boolean>) => void;
  onExecute: (runner: () => Promise<Uint8Array>) => Promise<void>;
  isProcessing: boolean;
  extraState?: Record<string, unknown>;
  onExtraStateChange?: (key: string, value: unknown) => void;
  outputBaseName?: string;
  onOutputBaseNameChange?: (name: string) => void;
  defaultBaseName?: string;
  outputExtension?: '.pdf' | '.zip' | string;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  icon: string;
  fileType: ToolFileType;
  actionVerb: string;
  noun: string;
  outputName: string;
  options: ToolOption[];
  availability: ToolAvailability;
  /**
   * Statically analyzable dynamic import loader for on-demand code splitting.
   */
  component?: () => Promise<{ default: ComponentType<ToolComponentProps> }>;
}

export interface WorkerRequest<T = unknown> {
  id: string;
  operation: string;
  payload: T;
}

export type WorkerResponse<R = unknown> =
  | { id: string; ok: true; result: R }
  | { id: string; ok: false; error: string };

