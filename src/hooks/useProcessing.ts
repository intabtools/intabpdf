// Hook exposing the global file-processing loader across tools and screens.
import { useContext } from 'react';
import { ProcessingContext, type ProcessingContextType } from '../components/processingContextDef';

export function useProcessing(): ProcessingContextType {
  const context = useContext(ProcessingContext);
  if (!context) {
    throw new Error('useProcessing must be used within a ProcessingProvider');
  }
  return context;
}
