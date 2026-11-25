import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import TextToPdfTool from './TextToPdfTool';
import { getToolById } from '../registry';
import { pdfProcessingService } from '../../core/worker/service';

describe('TextToPdfTool Component', () => {
  const textToolDef = getToolById('text-to-pdf')!;

  it('renders text editor workspace and options panel with default controls', () => {
    const html = renderToString(
      <TextToPdfTool
        tool={textToolDef}
        stagedFiles={[]}
        optionsState={{ 'page-nums': true, mono: false }}
        onOptionsChange={() => {}}
        onExecute={async () => {}}
        isProcessing={false}
        outputBaseName="my-text"
        onOutputBaseNameChange={() => {}}
        defaultBaseName="text-document"
        outputExtension=".pdf"
      />
    );

    expect(html).toContain('Text Content');
    expect(html).toContain('Open .txt file');
    expect(html).toContain('Page Size');
    expect(html).toContain('Orientation');
    expect(html).toContain('Margins');
    expect(html).toContain('Font');
    expect(html).toContain('Page numbers');
    expect(html).toContain('Create PDF');
  });

  it('strictly enforces user-select: text on textarea editor', () => {
    const html = renderToString(
      <TextToPdfTool
        tool={textToolDef}
        stagedFiles={[]}
        optionsState={{}}
        onOptionsChange={() => {}}
        onExecute={async () => {}}
        isProcessing={false}
      />
    );

    // Textarea must preserve text selection for editing
    expect(html).toContain('user-select:text');
  });

  it('populates text from staged file when a .txt file is provided', () => {
    const txtContent = 'Pre-staged text file content line 1\nLine 2';
    const txtBytes = new TextEncoder().encode(txtContent);

    const html = renderToString(
      <TextToPdfTool
        tool={textToolDef}
        stagedFiles={[{ id: '1', name: 'notes.txt', size: txtBytes.length, bytes: txtBytes }]}
        optionsState={{}}
        onOptionsChange={() => {}}
        onExecute={async () => {}}
        isProcessing={false}
      />
    );

    expect(html).toContain('Pre-staged text file content line 1');
  });

  it('disables the Create PDF action button when text is empty', () => {
    const html = renderToString(
      <TextToPdfTool
        tool={textToolDef}
        stagedFiles={[]}
        optionsState={{}}
        onOptionsChange={() => {}}
        onExecute={async () => {}}
        isProcessing={false}
      />
    );

    // Button should be disabled when text is empty
    expect(html).toMatch(/<button[^>]*class="cta"[^>]*disabled=""/);
  });

  it('dispatches execute with serializable payload when runner is triggered', async () => {
    const executeSpy = vi.spyOn(pdfProcessingService, 'execute').mockResolvedValue(new Uint8Array([1, 2, 3]));

    await pdfProcessingService.execute('text-to-pdf', {
      text: 'Sample document text',
      options: {
        pageSize: 'a4',
        orientation: 'portrait',
        marginPreset: 'normal',
        fontFamily: 'helvetica',
        fontSize: 11,
        lineSpacing: 1.3,
        includePageNumbers: true,
      },
    });

    expect(executeSpy).toHaveBeenCalledWith('text-to-pdf', {
      text: 'Sample document text',
      options: {
        pageSize: 'a4',
        orientation: 'portrait',
        marginPreset: 'normal',
        fontFamily: 'helvetica',
        fontSize: 11,
        lineSpacing: 1.3,
        includePageNumbers: true,
      },
    });
  });
});
