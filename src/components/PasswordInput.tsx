import { forwardRef, useId, useState } from 'react';
import type { ChangeEvent, CSSProperties, InputHTMLAttributes, ReactNode } from 'react';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';

export interface PasswordInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** The controlled password string. */
  value: string;
  /** Standard change handler returning the input change event. */
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  /** Value-only change handler for streamlined state setters. */
  onValueChange?: (value: string) => void;
  /** Accessible label displayed above the input. */
  label?: ReactNode;
  /** Indicates whether the field is mandatory (displays red asterisk and sets aria-required). */
  required?: boolean;
  /** Error message string/node, or boolean flag to indicate error border. */
  error?: ReactNode;
  /** Secondary guidance text shown below the input when no error is active. */
  helperText?: ReactNode;
  /** Background surface variant: 'surface' (card matching) or 'surface-2' (recessed dialog). */
  variant?: 'surface' | 'surface-2';
  /** Accessible label for the toggle button when password is hidden. Defaults to "Show password". */
  showPasswordLabel?: string;
  /** Accessible label for the toggle button when password is visible. Defaults to "Hide password". */
  hidePasswordLabel?: string;
  /** TabIndex for the visibility toggle button. Defaults to 0 (keyboard accessible). */
  toggleTabIndex?: number;
  /** Inline style overrides for the outer container. */
  containerStyle?: CSSProperties;
  /** Inline style overrides for the label element. */
  labelStyle?: CSSProperties;
  /** Inline style overrides for the input element. */
  inputStyle?: CSSProperties;
  /** Optional nested content (e.g. password strength meter) rendered inside the group. */
  children?: ReactNode;
}

const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  {
    id: explicitId,
    value,
    onChange,
    onValueChange,
    label,
    required = false,
    error,
    helperText,
    variant = 'surface',
    showPasswordLabel = 'Show password',
    hidePasswordLabel = 'Hide password',
    toggleTabIndex = 0,
    containerStyle,
    labelStyle,
    inputStyle,
    children,
    placeholder,
    disabled = false,
    autoComplete = 'current-password',
    className = '',
    style,
    ...rest
  },
  ref
): ReactNode {
  const generatedId = useId();
  const inputId = explicitId || `password-input-${generatedId}`;
  const errorId = `${inputId}-error`;
  const helperId = `${inputId}-helper`;

  const [showPassword, setShowPassword] = useState(false);

  const hasError = Boolean(error);
  const errorMessage = typeof error === 'string' || (error && typeof error !== 'boolean') ? error : null;

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange?.(e);
    onValueChange?.(e.target.value);
  };

  const handleToggle = () => {
    if (disabled) return;
    setShowPassword((prev) => !prev);
  };

  // Determine describedby IDs
  const describedByParts: string[] = [];
  if (errorMessage) {
    describedByParts.push(errorId);
  } else if (helperText) {
    describedByParts.push(helperId);
  }
  const ariaDescribedBy = describedByParts.length > 0 ? describedByParts.join(' ') : undefined;

  const bgToken = variant === 'surface-2' ? 'var(--surface-2)' : 'var(--surface)';

  return (
    <div
      className={`password-input-group ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        ...containerStyle,
        ...style,
      }}
    >
      {label && (
        <label
          htmlFor={inputId}
          className="password-input-label"
          style={{
            fontSize: '13px',
            fontWeight: 600,
            display: 'block',
            marginBottom: '6px',
            color: 'var(--text)',
            ...labelStyle,
          }}
        >
          {label}
          {required && (
            <span style={{ color: 'var(--danger)' }} aria-hidden="true">
              {' '}*
            </span>
          )}
        </label>
      )}

      <div
        className="password-input-wrapper"
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          width: '100%',
        }}
      >
        <input
          ref={ref}
          id={inputId}
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={autoComplete}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
          aria-required={required ? 'true' : undefined}
          aria-invalid={hasError ? 'true' : undefined}
          aria-describedby={ariaDescribedBy}
          className="password-input-control"
          style={{
            width: '100%',
            padding: '8px 44px 8px 10px',
            borderRadius: 'var(--radius-sm)',
            border: `1px solid ${hasError ? 'var(--danger)' : 'var(--border)'}`,
            background: bgToken,
            color: 'var(--text)',
            fontSize: '13px',
            userSelect: 'text',
            boxSizing: 'border-box',
            transition: 'border-color 0.15s, background-color 0.15s',
            ...inputStyle,
          }}
          {...rest}
        />

        <button
          type="button"
          className="password-toggle-btn"
          aria-label={showPassword ? hidePasswordLabel : showPasswordLabel}
          aria-pressed={showPassword}
          onClick={handleToggle}
          disabled={disabled}
          tabIndex={toggleTabIndex}
        >
          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>

      {errorMessage && (
        <div
          id={errorId}
          role="alert"
          className="password-input-error"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            color: 'var(--danger)',
            fontSize: '12px',
            marginTop: '4px',
          }}
        >
          <AlertCircle size={13} style={{ flexShrink: 0 }} />
          <span>{errorMessage}</span>
        </div>
      )}

      {helperText && !errorMessage && (
        <small
          id={helperId}
          className="password-input-helper"
          style={{
            color: 'var(--text-muted)',
            fontSize: '11px',
            marginTop: '4px',
            display: 'block',
          }}
        >
          {helperText}
        </small>
      )}

      {children}
    </div>
  );
});

export default PasswordInput;
