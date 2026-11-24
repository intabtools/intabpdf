import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import ReorderTool from './ReorderTool';
import { getToolById } from '../registry';
import { pdfProcessingService } from '../../core/worker/service';

describe('ReorderTool Component', () => {
  const reorderDef = getToolById('reorder')!;

  it('renders reorder controls, thumbnail switch, and options panel', () => {
    const html = renderToString(
      <ReorderTool
        tool={reorderDef}
        stagedFiles={[]}
        optionsState={{ thumbs: true }}
        onOptionsChange={() => {}}
        onExecute={async () => {}}
        isProcessing={false}
        outputBaseName="reordered"
        onOutputBaseNameChange={() => {}}
        defaultBaseName="reordered-doc"
        outputExtension=".pdf"
      />
    );

    expect(html).toContain('Page Order');
    expect(html).toContain('Show thumbnails');
    expect(html).toContain('Reorder PDF');
    expect(html).toContain('Output file name');
  });

  it('disables CTA button when no file is staged or during processing', () => {
    const html = renderToString(
      <ReorderTool
        tool={reorderDef}
        stagedFiles={[]}
        optionsState={{}}
        onOptionsChange={() => {}}
        onExecute={async () => {}}
        isProcessing={false}
      />
    );

    expect(html).toMatch(/<button[^>]*class="cta"[^>]*disabled=""/);
  });

  it('dispatches reorder operation through pdfProcessingService', async () => {
    const dummyBytes = new Uint8Array([1, 2, 3]);
    const executeSpy = vi.spyOn(pdfProcessingService, 'execute').mockResolvedValue(new Uint8Array([4, 5, 6]));

    await pdfProcessingService.execute('reorder', {
      buffer: dummyBytes,
      pageOrder: [2, 0, 1],
    });

    expect(executeSpy).toHaveBeenCalledWith('reorder', {
      buffer: dummyBytes,
      pageOrder: [2, 0, 1],
    });
  });
});
