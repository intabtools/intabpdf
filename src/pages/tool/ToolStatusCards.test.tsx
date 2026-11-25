import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import ToolStatusCards from './ToolStatusCards';

describe('ToolStatusCards', () => {
  it('renders error retry button with theme-contrast tokens instead of inherited light-only text color', () => {
    const html = renderToString(
      <ToolStatusCards
        status="idle"
        errorMessage="Sample failure"
        onClearError={() => {}}
      />
    );

    expect(html).toContain('Operation failed');
    expect(html).toContain('Sample failure');
    expect(html).toContain('Try again');
    expect(html).toContain('background:var(--text)');
    expect(html).toContain('color:var(--background)');
  });
});
