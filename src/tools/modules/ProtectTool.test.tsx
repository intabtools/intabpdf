import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import ProtectTool from './ProtectTool';
import { getToolById } from '../registry';

describe('ProtectTool Component', () => {
  const protectDef = getToolById('protect')!;

  it('renders password input fields, algorithm choices, and permission switches', () => {
    const html = renderToString(
      <ProtectTool
        tool={protectDef}
        stagedFiles={[]}
        optionsState={{}}
        onOptionsChange={() => {}}
        onExecute={async () => {}}
        isProcessing={false}
        outputBaseName="protected"
        onOutputBaseNameChange={() => {}}
        defaultBaseName="document-protected"
        outputExtension=".pdf"
      />
    );

    expect(html).toContain('Set Document Password');
    expect(html).toContain('Document Password');
    expect(html).toContain('Confirm Password');
    expect(html).toContain('Encryption Algorithm');
    expect(html).toContain('AES-256 (Modern)');
    expect(html).toContain('RC4-128 (Legacy)');
    expect(html).toContain('Document Permissions');
    expect(html).toContain('Allow printing');
    expect(html).toContain('Allow copying text');
    expect(html).toContain('Allow modifying');
    expect(html).toContain('Allow annotations');
    expect(html).toContain('Protect PDF');
  });

  it('displays the client-side local encryption assurance notice', () => {
    const html = renderToString(
      <ProtectTool
        tool={protectDef}
        stagedFiles={[]}
        optionsState={{}}
        onOptionsChange={() => {}}
        onExecute={async () => {}}
        isProcessing={false}
      />
    );

    expect(html).toContain('Client-Side Local Encryption:');
    expect(html).toContain('password is never transmitted to any server');
  });

  it('disables CTA button when password is empty or no file is staged', () => {
    const html = renderToString(
      <ProtectTool
        tool={protectDef}
        stagedFiles={[]}
        optionsState={{}}
        onOptionsChange={() => {}}
        onExecute={async () => {}}
        isProcessing={false}
      />
    );

    expect(html).toContain('disabled=""');
  });
});
