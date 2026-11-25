import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import SignTool from './SignTool';
import { getToolById } from '../registry';
import { pdfProcessingService } from '../../core/worker/service';

describe('SignTool Component', () => {
  const signDef = getToolById('sign')!;

  it('renders signature creation tabs and placement options', () => {
    const html = renderToString(
      <SignTool
        tool={signDef}
        stagedFiles={[]}
        optionsState={{ 'add-date': true }}
        onOptionsChange={() => {}}
        onExecute={async () => {}}
        isProcessing={false}
        outputBaseName="signed"
        onOutputBaseNameChange={() => {}}
        defaultBaseName="signed-document"
        outputExtension=".pdf"
      />
    );

    expect(html).toContain('Create Signature');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Signature creation modes"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-controls="sign-panel-draw"');
    expect(html).toContain('aria-controls="sign-panel-type"');
    expect(html).toContain('aria-controls="sign-panel-upload"');
    expect(html).toContain('id="sign-panel-draw"');
    expect(html).toContain('id="sign-panel-type"');
    expect(html).toContain('id="sign-panel-upload"');
    expect(html).toContain('aria-labelledby="sign-tab-draw"');
    expect(html).toContain('aria-labelledby="sign-tab-type"');
    expect(html).toContain('aria-labelledby="sign-tab-upload"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toMatch(/id="sign-panel-type"[^>]*hidden=""/);
    expect(html).toMatch(/id="sign-panel-upload"[^>]*hidden=""/);
    expect(html).toContain('for="sign-page-select"');
    expect(html).toContain('id="sign-page-select"');
    expect(html).toContain('Draw');
    expect(html).toContain('Type');
    expect(html).toContain('Upload');
    expect(html).toContain('Sign Page');
    expect(html).toContain('Position');
    expect(html).toContain('Add today date');
    expect(html).toContain('Sign PDF');
  });

  it('displays the visual signature stamp notice clarifying it is not a cryptographic certificate', () => {
    const html = renderToString(
      <SignTool
        tool={signDef}
        stagedFiles={[]}
        optionsState={{}}
        onOptionsChange={() => {}}
        onExecute={async () => {}}
        isProcessing={false}
      />
    );

    expect(html).toContain('notice-banner-info');
    expect(html).toContain('Visual Signature Stamp:');
    expect(html).toContain('not a cryptographic PKI digital certificate');
  });

  it('disables CTA button when no signature is ready or no file is staged', () => {
    const html = renderToString(
      <SignTool
        tool={signDef}
        stagedFiles={[]}
        optionsState={{}}
        onOptionsChange={() => {}}
        onExecute={async () => {}}
        isProcessing={false}
      />
    );

    expect(html).toMatch(/<button[^>]*class="cta"[^>]*disabled=""/);
  });

  it('dispatches sign operation through pdfProcessingService', async () => {
    const dummyPdf = new Uint8Array([1, 2, 3]);
    const dummySig = new Uint8Array([4, 5, 6]);
    const executeSpy = vi.spyOn(pdfProcessingService, 'execute').mockResolvedValue(new Uint8Array([7, 8, 9]));

    await pdfProcessingService.execute('sign', {
      buffer: dummyPdf,
      signatureBytes: dummySig,
      options: { position: 'bottom-right', addDate: true },
    });

    expect(executeSpy).toHaveBeenCalledWith('sign', {
      buffer: dummyPdf,
      signatureBytes: dummySig,
      options: { position: 'bottom-right', addDate: true },
    });
  });
});
