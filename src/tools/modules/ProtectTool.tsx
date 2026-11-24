// Tool module for password-protecting PDF documents locally.
import { useEffect, useId, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { AlertCircle, Eye, EyeOff, Lock, ShieldCheck, ShieldAlert } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import type { ToolComponentProps } from '../types';
import type { ProtectPdfOptions } from '../../core/protect';
import { isEncrypted } from '@pdfsmaller/pdf-decrypt';
import { pdfProcessingService } from '../../core/worker/service';

interface PasswordStrength {
  score: number;
  label: string;
  color: string;
}

function computePasswordStrength(pwd: string): PasswordStrength {
  if (!pwd) {
    return { score: 0, label: '', color: 'transparent' };
  }
  let score = 0;
  if (pwd.length >= 6) score += 1;
  if (pwd.length >= 10) score += 1;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score += 1;
  if (/\d/.test(pwd)) score += 1;
  if (/[^A-Za-z0-9]/.test(pwd)) score += 1;

  if (score <= 1) {
    return { score: 1, label: 'Weak', color: '#e53e3e' };
  }
  if (score <= 3) {
    return { score: 2, label: 'Moderate', color: '#dd6b20' };
  }
  if (score === 4) {
    return { score: 3, label: 'Strong', color: '#3182ce' };
  }
  return { score: 4, label: 'Very strong', color: '#38a169' };
}

export default function ProtectTool({
  stagedFiles,
  optionsState,
  onOptionsChange,
  onExecute,
  isProcessing,
  outputBaseName,
  onOutputBaseNameChange,
  defaultBaseName,
  outputExtension,
}: ToolComponentProps): ReactNode {
  const passwordInputId = useId();
  const confirmPasswordInputId = useId();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [algorithm, setAlgorithm] = useState<'AES-256' | 'RC4'>('AES-256');

  const [allowPrinting, setAllowPrinting] = useState<boolean>(() => !optionsState['block-print']);
  const [allowCopying, setAllowCopying] = useState(true);
  const [allowModifying, setAllowModifying] = useState(false);
  const [allowAnnotating, setAllowAnnotating] = useState(false);

  const [isDocEncrypted, setIsDocEncrypted] = useState<boolean | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const file = stagedFiles[0];
  const [prevFileId, setPrevFileId] = useState<string | undefined>(file?.id);

  if (file?.id !== prevFileId) {
    setPrevFileId(file?.id);
    setIsDocEncrypted(null);
    setValidationError(null);
  }

  // Check if incoming staged document is already encrypted
  useEffect(() => {
    let active = true;
    if (file?.bytes) {
      void isEncrypted(file.bytes).then(
        (status) => {
          if (!active) return;
          setIsDocEncrypted(status.encrypted);
        },
        () => {
          if (!active) return;
          setIsDocEncrypted(false);
        }
      );
    }
    return () => {
      active = false;
    };
  }, [file?.bytes]);

  const strength = computePasswordStrength(password);
  const passwordsMatch = confirmPassword.length === 0 || password === confirmPassword;
  const isFormValid =
    password.trim().length > 0 &&
    (confirmPassword.length === 0 || password === confirmPassword) &&
    isDocEncrypted !== true;

  const handlePasswordChange = (e: ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    setValidationError(null);
  };

  const handleConfirmPasswordChange = (e: ChangeEvent<HTMLInputElement>) => {
    setConfirmPassword(e.target.value);
    setValidationError(null);
  };

  const handleRun = async () => {
    if (!file?.bytes || !isFormValid || isProcessing) return;

    if (confirmPassword.length > 0 && password !== confirmPassword) {
      setValidationError('Passwords do not match. Please verify your password.');
      return;
    }

    const protectOptions: ProtectPdfOptions = {
      password,
      algorithm,
      allowPrinting,
      allowCopying,
      allowModifying,
      allowAnnotating,
    };

    await onExecute(async (signal) => {
      return await pdfProcessingService.execute(
        'protect',
        {
          buffer: file.bytes,
          options: protectOptions,
        },
        { signal }
      );
    });
  };

  return (
    <>
      {/* Left Column: Password Entry & Security Notice */}
      <div
        className="card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          minWidth: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Lock size={18} style={{ color: 'var(--accent)' }} />
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Set Document Password</h3>
        </div>

        {/* Already encrypted warning banner */}
        {isDocEncrypted === true && (
          <div
            role="alert"
            style={{
              padding: '12px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--danger-soft)',
              border: '1px solid var(--danger)',
              color: 'var(--danger)',
              fontSize: '13px',
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
            }}
          >
            <ShieldAlert size={18} style={{ flexShrink: 0 }} />
            <div>
              <strong>Document is already protected:</strong> This PDF is already password protected. Unlock it first before applying new protection.
            </div>
          </div>
        )}

        {/* Validation error banner */}
        {validationError && (
          <div
            role="alert"
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--danger-soft)',
              border: '1px solid var(--danger)',
              color: 'var(--danger)',
              fontSize: '13px',
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{validationError}</span>
          </div>
        )}

        {/* Password input field */}
        <div>
          <label
            htmlFor={passwordInputId}
            style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}
          >
            Document Password <span style={{ color: 'var(--danger, #e53e3e)' }}>*</span>
          </label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              id={passwordInputId}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={handlePasswordChange}
              placeholder="Enter password to open this PDF"
              autoComplete="new-password"
              style={{
                width: '100%',
                padding: '8px 36px 8px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: '13px',
                userSelect: 'text',
              }}
            />
            <button
              type="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: 'absolute',
                right: '8px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {/* Password strength indicator */}
          {password.length > 0 && (
            <div style={{ marginTop: '6px' }}>
              <div
                style={{
                  display: 'flex',
                  gap: '4px',
                  height: '4px',
                  borderRadius: '2px',
                  overflow: 'hidden',
                  background: 'var(--border)',
                }}
              >
                {[1, 2, 3, 4].map((step) => (
                  <div
                    key={step}
                    style={{
                      flex: 1,
                      background: step <= strength.score ? strength.color : 'transparent',
                      transition: 'background 0.2s ease',
                    }}
                  />
                ))}
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  marginTop: '4px',
                }}
              >
                <span>Strength: <strong style={{ color: strength.color }}>{strength.label}</strong></span>
                <span>Minimum 6 characters recommended</span>
              </div>
            </div>
          )}
        </div>

        {/* Confirm password input field */}
        <div>
          <label
            htmlFor={confirmPasswordInputId}
            style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}
          >
            Confirm Password
          </label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              id={confirmPasswordInputId}
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={handleConfirmPasswordChange}
              placeholder="Re-enter password to confirm"
              autoComplete="new-password"
              style={{
                width: '100%',
                padding: '8px 36px 8px 10px',
                borderRadius: 'var(--radius-sm)',
                border: `1px solid ${!passwordsMatch ? '#e53e3e' : 'var(--border)'}`,
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: '13px',
                userSelect: 'text',
              }}
            />
            <button
              type="button"
              aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              style={{
                position: 'absolute',
                right: '8px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {!passwordsMatch && (
            <span style={{ color: '#e53e3e', fontSize: '11px', marginTop: '4px', display: 'block' }}>
              Passwords do not match
            </span>
          )}
        </div>

        {/* Client-Side Security Assurance Notice */}
        <div
          style={{
            padding: '12px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            fontSize: '12px',
            lineHeight: 1.5,
            color: 'var(--text-muted)',
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-start',
            marginTop: 'auto',
          }}
        >
          <ShieldCheck size={16} style={{ flexShrink: 0, marginTop: '2px', color: 'var(--accent)' }} />
          <div>
            <strong>Client-Side Local Encryption:</strong> Your document is encrypted directly in your browser.
            The password is never transmitted to any server. Keep your password safe: there is no recovery option if forgotten.
          </div>
        </div>
      </div>

      {/* Right Column: Security Options & Action */}
      <div className="card opts">
        {/* Encryption Algorithm Selection */}
        <div>
          <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
            Encryption Algorithm
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <button
              type="button"
              className={`btn btn-secondary ${algorithm === 'AES-256' ? 'active' : ''}`}
              style={{
                fontSize: '11px',
                padding: '6px',
                fontWeight: algorithm === 'AES-256' ? 600 : 400,
                background: algorithm === 'AES-256' ? 'var(--accent)' : undefined,
                color: algorithm === 'AES-256' ? '#fff' : undefined,
              }}
              onClick={() => setAlgorithm('AES-256')}
            >
              AES-256 (Modern)
            </button>
            <button
              type="button"
              className={`btn btn-secondary ${algorithm === 'RC4' ? 'active' : ''}`}
              style={{
                fontSize: '11px',
                padding: '6px',
                fontWeight: algorithm === 'RC4' ? 600 : 400,
                background: algorithm === 'RC4' ? 'var(--accent)' : undefined,
                color: algorithm === 'RC4' ? '#fff' : undefined,
              }}
              onClick={() => setAlgorithm('RC4')}
            >
              RC4-128 (Legacy)
            </button>
          </div>
        </div>

        {/* Permissions Switches */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600 }}>Document Permissions</span>

          <div className="sw">
            <span>
              Allow printing
              <small>Recipients can print document</small>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={allowPrinting}
              aria-label="Allow printing"
              className={`tg ${allowPrinting ? 'on' : ''}`}
              onClick={() => {
                const next = !allowPrinting;
                setAllowPrinting(next);
                onOptionsChange?.({
                  ...optionsState,
                  'block-print': !next,
                });
              }}
            />
          </div>

          <div className="sw">
            <span>
              Allow copying text
              <small>Recipients can copy text and graphics</small>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={allowCopying}
              aria-label="Allow copying text"
              className={`tg ${allowCopying ? 'on' : ''}`}
              onClick={() => setAllowCopying(!allowCopying)}
            />
          </div>

          <div className="sw">
            <span>
              Allow modifying
              <small>Recipients can edit pages</small>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={allowModifying}
              aria-label="Allow modifying"
              className={`tg ${allowModifying ? 'on' : ''}`}
              onClick={() => setAllowModifying(!allowModifying)}
            />
          </div>

          <div className="sw">
            <span>
              Allow annotations
              <small>Recipients can add comments</small>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={allowAnnotating}
              aria-label="Allow annotations"
              className={`tg ${allowAnnotating ? 'on' : ''}`}
              onClick={() => setAllowAnnotating(!allowAnnotating)}
            />
          </div>
        </div>

        {/* Output filename input */}
        <div style={{ marginTop: '4px', marginBottom: '4px' }}>
          <OutputFilenameInput
            value={outputBaseName ?? ''}
            onChange={onOutputBaseNameChange ?? (() => {})}
            placeholder={defaultBaseName ?? 'protected'}
            extension={outputExtension ?? '.pdf'}
          />
        </div>

        <button
          type="button"
          className="cta"
          onClick={handleRun}
          disabled={isProcessing || !file || !isFormValid}
        >
          <Lock size={16} style={{ flexShrink: 0 }} />
          <span>{isProcessing ? 'Protecting...' : 'Protect PDF'}</span>
        </button>
      </div>
    </>
  );
}
