import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import UnlockTool from './UnlockTool';
import { getToolById } from '../registry';

describe('UnlockTool Component', () => {
  const unlockDef = getToolById('unlock')!;

  it('renders password input fields, security notice, and unlock CTA', () => {
    const html = renderToString(
      <UnlockTool
        tool={unlockDef}
        stagedFiles={[]}
        optionsState={{}}
        onOptionsChange={() => {}}
        onExecute={async () => {}}
        isProcessing={false}
        outputBaseName="unlocked"
        onOutputBaseNameChange={() => {}}
        defaultBaseName="document-unlocked"
        outputExtension=".pdf"
      />
    );

    expect(html).toContain('Enter Document Password');
    expect(html).toContain('Password');
    expect(html).toContain('Permanent Removal');
    expect(html).toContain('Unlock PDF');
  });

  it('displays the client-side local decryption assurance notice', () => {
    const html = renderToString(
      <UnlockTool
        tool={unlockDef}
        stagedFiles={[]}
        optionsState={{}}
        onOptionsChange={() => {}}
        onExecute={async () => {}}
        isProcessing={false}
      />
    );

    expect(html).toContain('Client-Side Decryption:');
    expect(html).toContain('never transmitted to any external server');
  });

  it('disables CTA button when password is empty or no file is staged', () => {
    const html = renderToString(
      <UnlockTool
        tool={unlockDef}
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
