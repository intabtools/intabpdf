import { useContext } from 'react';
import { ShellContext, type ShellContextType } from '../components/shellContextDef';

export function useShell(): ShellContextType {
  const ctx = useContext(ShellContext);
  if (!ctx) {
    return {
      shell: 'app',
      setShell: () => {},
      showAppLayout: true,
      setShowAppLayout: () => {},
    };
  }
  return ctx;
}
