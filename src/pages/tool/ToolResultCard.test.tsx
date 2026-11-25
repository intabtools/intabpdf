import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import ToolResultCard from './ToolResultCard';
import { getToolById } from '../../tools/registry';
import type { StagedFile } from '../../tools/types';

describe('ToolResultCard Phase 4 accessibility', () => {
  it('avoids nested role="status" inside the outer aria-live="polite" results region', () => {
    const extractTool = getToolById('extract-text')!;
    const stagedFile: StagedFile = {
      id: 'scan-1',
      name: 'scan.pdf',
      size: 1024,
      bytes: new Uint8Array(10),
    };

    const html = renderToString(
      <ToolResultCard
        tool={extractTool}
        stagedFiles={[stagedFile]}
        outputBytes={new Uint8Array(0)}
        extraState={{ hasImages: true, wordCount: 0 }}
        customFileName=""
        onCustomFileNameChange={() => {}}
        defaultBaseName="extracted-scan"
        outputExtension=".txt"
        isSaved={false}
        isZipOutput={false}
        platformType="web"
        onDownload={() => {}}
        onViewPdf={() => {}}
        onStartOver={() => {}}
      />
    );

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('notice-banner-warning');
    expect(html).toContain('Image-based PDF (OCR required)');
    expect(html).not.toContain('role="status"');
  });
});
