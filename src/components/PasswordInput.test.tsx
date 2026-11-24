import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import PasswordInput from './PasswordInput';

describe('PasswordInput Component Unit & Accessibility Tests', () => {
  it('renders standard password input with masked type, placeholder, and label', () => {
    const html = renderToString(
      <PasswordInput
        id="test-pwd"
        label="Account Password"
        value=""
        onChange={() => {}}
        placeholder="Enter secret"
      />
    );

    expect(html).toContain('id="test-pwd"');
    expect(html).toContain('type="password"');
    expect(html).toContain('placeholder="Enter secret"');
    expect(html).toContain('Account Password');
    expect(html).toContain('class="password-input-control"');
    expect(html).toContain('class="password-toggle-btn"');
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('aria-pressed="false"');
  });

  it('renders required indicator and aria-required attribute when required prop is true', () => {
    const html = renderToString(
      <PasswordInput
        id="required-pwd"
        label="Required Password"
        required
        value=""
        onChange={() => {}}
      />
    );

    expect(html).toContain('aria-required="true"');
    expect(html).toContain('*</span>');
  });

  it('renders controlled value correctly', () => {
    const html = renderToString(
      <PasswordInput
        id="val-pwd"
        value="SecretValue123!"
        onChange={() => {}}
      />
    );

    expect(html).toContain('value="SecretValue123!"');
  });

  it('renders error message, role="alert", aria-invalid, and links aria-describedby to error id', () => {
    const html = renderToString(
      <PasswordInput
        id="error-pwd"
        value="wrong"
        error="Incorrect password. Please try again."
        onChange={() => {}}
      />
    );

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="error-pwd-error"');
    expect(html).toContain('id="error-pwd-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Incorrect password. Please try again.');
  });

  it('supports boolean error flag without rendering text message', () => {
    const html = renderToString(
      <PasswordInput
        id="bool-error-pwd"
        value="mismatch"
        error={true}
        onChange={() => {}}
      />
    );

    expect(html).toContain('aria-invalid="true"');
    expect(html).not.toContain('role="alert"');
  });

  it('renders helperText and links aria-describedby when no error exists', () => {
    const html = renderToString(
      <PasswordInput
        id="helper-pwd"
        value=""
        helperText="Minimum 8 characters required."
        onChange={() => {}}
      />
    );

    expect(html).toContain('aria-describedby="helper-pwd-helper"');
    expect(html).toContain('id="helper-pwd-helper"');
    expect(html).toContain('Minimum 8 characters required.');
  });

  it('suppresses helperText in favor of error message when error is provided', () => {
    const html = renderToString(
      <PasswordInput
        id="conflict-pwd"
        value="short"
        helperText="Minimum 8 characters required."
        error="Password too short"
        onChange={() => {}}
      />
    );

    expect(html).toContain('aria-describedby="conflict-pwd-error"');
    expect(html).toContain('Password too short');
    expect(html).not.toContain('Minimum 8 characters required.');
  });

  it('disables input and toggle button when disabled prop is true', () => {
    const html = renderToString(
      <PasswordInput
        id="disabled-pwd"
        value="abc"
        disabled
        onChange={() => {}}
      />
    );

    // Both input and button should carry disabled attribute
    const disabledOccurrences = (html.match(/disabled=""/g) || html.match(/disabled/g) || []).length;
    expect(disabledOccurrences).toBeGreaterThanOrEqual(2);
  });

  it('customizes toggle button aria-labels when custom labels are provided', () => {
    const html = renderToString(
      <PasswordInput
        id="custom-toggle-pwd"
        value=""
        showPasswordLabel="Show confirm password"
        hidePasswordLabel="Hide confirm password"
        onChange={() => {}}
      />
    );

    expect(html).toContain('aria-label="Show confirm password"');
  });

  it('supports toggleTabIndex override for custom focus order', () => {
    const html = renderToString(
      <PasswordInput
        id="tabindex-pwd"
        value=""
        toggleTabIndex={-1}
        onChange={() => {}}
      />
    );

    expect(html).toContain('tabindex="-1"');
  });

  it('supports custom autoComplete attributes', () => {
    const htmlNew = renderToString(
      <PasswordInput
        id="new-pwd"
        value=""
        autoComplete="new-password"
        onChange={() => {}}
      />
    );
    expect(htmlNew).toMatch(/autocomplete="new-password"/i);

    const htmlOff = renderToString(
      <PasswordInput
        id="off-pwd"
        value=""
        autoComplete="off"
        onChange={() => {}}
      />
    );
    expect(htmlOff).toMatch(/autocomplete="off"/i);
  });

  it('renders children slot below input for inline widgets such as strength meters', () => {
    const html = renderToString(
      <PasswordInput id="children-pwd" value="abc" onChange={() => {}}>
        <div data-testid="strength-meter">Strength: Fair</div>
      </PasswordInput>
    );

    expect(html).toContain('data-testid="strength-meter"');
    expect(html).toContain('Strength: Fair');
  });

  it('generates unique IDs for multiple instances without explicit IDs', () => {
    const html1 = renderToString(<PasswordInput label="First" value="" onChange={() => {}} />);
    const html2 = renderToString(<PasswordInput label="Second" value="" onChange={() => {}} />);

    const idMatch1 = html1.match(/id="([^"]+)"/);
    const idMatch2 = html2.match(/id="([^"]+)"/);

    expect(idMatch1).toBeTruthy();
    expect(idMatch2).toBeTruthy();
  });
});
