import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ToolMissingState from './ToolMissingState';
import { getToolById } from '../../tools/registry';
import { resolveDestination } from '../../config/screens';

describe('Priority 5: Coming Soon Navigation & Placeholder', () => {
  it('resolves direct route for coming soon tools instead of falling back to /', () => {
    const protectResolved = resolveDestination('/tool/protect', 'web');
    expect(protectResolved).toBe('/tool/protect');

    const unlockResolved = resolveDestination('/tool/unlock', 'android');
    expect(unlockResolved).toBe('/tool/unlock');

    const fakeResolved = resolveDestination('/tool/fake-tool', 'web');
    expect(fakeResolved).toBe('/');
  });

  it('renders intended coming soon placeholder card with tool icon, name and back CTA', () => {
    const protectTool = getToolById('protect')!;
    expect(protectTool).toBeDefined();

    const html = renderToString(
      <MemoryRouter>
        <ToolMissingState tool={protectTool} onNavigateHome={() => {}} />
      </MemoryRouter>
    );

    expect(html).toContain('Protect');
    expect(html).toContain('This tool is coming soon.');
    expect(html).toContain('Back to All Tools');
    expect(html).toContain('card busy');
  });

  it('renders missing tool card when tool does not exist', () => {
    const html = renderToString(
      <MemoryRouter>
        <ToolMissingState tool={undefined} onNavigateHome={() => {}} />
      </MemoryRouter>
    );

    expect(html).toContain('Tool not found');
    expect(html).toContain('The requested tool does not exist.');
    expect(html).toContain('Back to All Tools');
  });
});
