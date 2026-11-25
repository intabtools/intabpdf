import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import NestedModalHarness from './NestedModalHarness';

export function mountNestedModalHarness(parentElement: HTMLElement): () => void {
  const host = document.createElement('div');
  host.id = 'nested-modal-test-host';
  parentElement.appendChild(host);

  const root = createRoot(host);
  root.render(createElement(StrictMode, null, createElement(NestedModalHarness)));

  return () => {
    root.unmount();
    host.remove();
  };
}
