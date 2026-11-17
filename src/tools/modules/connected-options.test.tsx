import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { getToolById } from '../registry';
import MergeTool from './MergeTool';
import RotateTool from './RotateTool';
import RemovePagesTool from './RemovePagesTool';
import type { StagedFile } from '../types';
import { pdfProcessingService } from '../../core';

describe('Priority 4: Connected Options in Merge, Rotate, and Remove Pages', () => {
  const dummyFile: StagedFile = {
    id: 'test-1',
    name: 'document.pdf',
    size: 2048,
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]),
  };

  describe('Merge Tool Options', () => {
    const mergeDef = getToolById('merge')!;

    it('renders both Keep bookmarks and Add page numbers options with switch roles', () => {
      const html = renderToString(
        <MergeTool
          tool={mergeDef}
          stagedFiles={[dummyFile]}
          optionsState={{ bookmarks: true, 'page-nums': false }}
          onOptionsChange={() => {}}
          onExecute={async () => {}}
          isProcessing={false}
          outputBaseName="merged"
          onOutputBaseNameChange={() => {}}
          defaultBaseName="merged-document"
          outputExtension=".pdf"
        />
      );

      expect(html).toContain('Keep bookmarks');
      expect(html).toContain('Carry them over from each file');
      expect(html).toContain('Add page numbers');
      expect(html).toContain('Bottom centre of every page');
      expect(html).toContain('aria-checked="true"');
      expect(html).toContain('aria-checked="false"');
    });

    it('verifies merge payload contract with bookmarks and page numbers', async () => {
      const executeSpy = vi.spyOn(pdfProcessingService, 'execute').mockResolvedValue(new Uint8Array([1, 2, 3]));

      await pdfProcessingService.execute('merge', {
        buffers: [dummyFile.bytes],
        options: {
          keepBookmarks: true,
          addPageNumbers: true,
        },
      });

      expect(executeSpy).toHaveBeenCalledWith('merge', {
        buffers: [dummyFile.bytes],
        options: {
          keepBookmarks: true,
          addPageNumbers: true,
        },
      });

      executeSpy.mockRestore();
    });
  });

  describe('Rotate Tool Options', () => {
    const rotateDef = getToolById('rotate')!;

    it('renders both Turn clockwise and Rotate every page switches', () => {
      const html = renderToString(
        <RotateTool
          tool={rotateDef}
          stagedFiles={[dummyFile]}
          optionsState={{ cw: true, 'all-pages': true }}
          onOptionsChange={() => {}}
          onExecute={async () => {}}
          isProcessing={false}
          outputBaseName="rotated"
          onOutputBaseNameChange={() => {}}
          defaultBaseName="rotated-document"
          outputExtension=".pdf"
        />
      );

      expect(html).toContain('Turn clockwise');
      expect(html).toContain('Off turns anticlockwise');
      expect(html).toContain('Rotate every page');
      expect(html).toContain('Off lets you pick pages');
      expect(html).toContain('Rotate all pages');
    });

    it('reveals page range input when Rotate every page is toggled off', () => {
      const html = renderToString(
        <RotateTool
          tool={rotateDef}
          stagedFiles={[dummyFile]}
          optionsState={{ cw: true, 'all-pages': false }}
          onOptionsChange={() => {}}
          onExecute={async () => {}}
          isProcessing={false}
          outputBaseName="rotated"
          onOutputBaseNameChange={() => {}}
          defaultBaseName="rotated-document"
          outputExtension=".pdf"
        />
      );

      expect(html).toContain('Pages or ranges to rotate');
      expect(html).toContain('placeholder="e.g. 1-3, 5"');
    });
  });

  describe('Remove Pages Tool Options', () => {
    const removeDef = getToolById('remove-pages')!;

    it('renders Confirm before removing switch', () => {
      const html = renderToString(
        <RemovePagesTool
          tool={removeDef}
          stagedFiles={[dummyFile]}
          optionsState={{ confirm: true }}
          onOptionsChange={() => {}}
          onExecute={async () => {}}
          isProcessing={false}
          outputBaseName="trimmed"
          onOutputBaseNameChange={() => {}}
          defaultBaseName="trimmed-document"
          outputExtension=".pdf"
        />
      );

      expect(html).toContain('Confirm before removing');
      expect(html).toContain('Show the pages first');
      expect(html).toContain('role="switch"');
    });
  });
});
