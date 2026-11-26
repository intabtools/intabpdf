import { useContext } from 'react';
import { SaveRecoveryContext, type SaveRecoveryContextValue } from '../components/saveRecoveryContextDef';

export function useSaveRecovery(): SaveRecoveryContextValue | null {
  return useContext(SaveRecoveryContext);
}
