import { createContext } from 'react';

export type ShellMode = 'web' | 'app';

export interface ShellContextType {
  shell: ShellMode;
  setShell: (mode: ShellMode) => void;
  showAppLayout: boolean;
  setShowAppLayout: (show: boolean | ((prev: boolean) => boolean)) => void;
}

export const ShellContext = createContext<ShellContextType | null>(null);
