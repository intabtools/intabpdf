import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import NoticeBanner from './NoticeBanner';

describe('NoticeBanner Component Unit & Accessibility Tests', () => {
  it('renders without live-region role by default to avoid unintended announcements on static notices', () => {
    const html = renderToString(
      <NoticeBanner variant="info">
        This is an informational notice.
      </NoticeBanner>
    );

    expect(html).toContain('class="notice-banner notice-banner-info "');
    expect(html).not.toContain('role=');
    expect(html).toContain('This is an informational notice.');
    expect(html).toContain('class="notice-banner-icon"');
  });

  it('renders explicit alert role when role="alert" is passed', () => {
    const html = renderToString(
      <NoticeBanner variant="danger" role="alert">
        Operation failed.
      </NoticeBanner>
    );

    expect(html).toContain('class="notice-banner notice-banner-danger "');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Operation failed.');
  });

  it('renders explicit status role when role="status" is passed', () => {
    const html = renderToString(
      <NoticeBanner variant="success" role="status">
        Document saved successfully.
      </NoticeBanner>
    );

    expect(html).toContain('class="notice-banner notice-banner-success "');
    expect(html).toContain('role="status"');
    expect(html).toContain('Document saved successfully.');
  });

  it('supports explicit role="region" or omitting role with null', () => {
    const htmlRegion = renderToString(
      <NoticeBanner variant="warning" role="region">
        Non-live warning notice.
      </NoticeBanner>
    );
    expect(htmlRegion).toContain('role="region"');

    const htmlStatic = renderToString(
      <NoticeBanner variant="info" role={null}>
        Static non-live guidance.
      </NoticeBanner>
    );
    expect(htmlStatic).not.toContain('role="');
  });

  it('renders optional title and body content together', () => {
    const html = renderToString(
      <NoticeBanner
        variant="warning"
        title="Warning Title"
      >
        Detailed warning message.
      </NoticeBanner>
    );

    expect(html).toContain('class="notice-banner-title"');
    expect(html).toContain('Warning Title');
    expect(html).toContain('class="notice-banner-body"');
    expect(html).toContain('Detailed warning message.');
  });

  it('supports custom icons and suppressing icons with icon={false}', () => {
    const htmlCustom = renderToString(
      <NoticeBanner
        variant="info"
        icon={<span data-testid="custom-icon">★</span>}
      >
        Custom icon notice.
      </NoticeBanner>
    );
    expect(htmlCustom).toContain('data-testid="custom-icon"');

    const htmlNoIcon = renderToString(
      <NoticeBanner variant="info" icon={false}>
        No icon notice.
      </NoticeBanner>
    );
    expect(htmlNoIcon).not.toContain('class="notice-banner-icon"');
  });

  it('renders dismiss button with accessible label when onDismiss is supplied', () => {
    const onDismiss = vi.fn();
    const html = renderToString(
      <NoticeBanner
        variant="info"
        onDismiss={onDismiss}
        dismissLabel="Close this alert"
      >
        Dismissable notice.
      </NoticeBanner>
    );

    expect(html).toContain('class="notice-banner-dismiss"');
    expect(html).toContain('aria-label="Close this alert"');
    expect(html).toContain('type="button"');
  });

  it('renders multiple NoticeBanner instances independently', () => {
    const html = renderToString(
      <div>
        <NoticeBanner variant="danger">First error</NoticeBanner>
        <NoticeBanner variant="success">Second success</NoticeBanner>
      </div>
    );

    expect(html).toContain('notice-banner-danger');
    expect(html).toContain('First error');
    expect(html).toContain('notice-banner-success');
    expect(html).toContain('Second success');
  });
});
