// Tool module for password-protecting PDF documents locally.
import { useEffect, useId, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { Lock, ShieldCheck, ShieldAlert } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import PasswordInput from '../../components/PasswordInput';
import NoticeBanner from '../../components/NoticeBanner';
import SegmentedControl from '../../components/SegmentedControl';
import type { ToolComponentProps } from '../types';
import { isAsciiPassword, type ProtectPdfOptions } from '../../core/protect';
import { inspectPdfEncryption, type PdfEncryptionInspection } from '../../core/pdfEncryptionStatus';
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
    return { score: 1, label: 'Weak', color: 'var(--danger)' };
  }
  if (score <= 3) {
    return { score: 2, label: 'Moderate', color: 'var(--warning)' };
  }
  if (score === 4) {
    return { score: 3, label: 'Strong', color: 'var(--accent)' };
  }
  return { score: 4, label: 'Very strong', color: 'var(--success)' };
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
  const [algorithm, setAlgorithm] = useState<'AES-256' | 'RC4'>('AES-256');

  const [allowPrinting, setAllowPrinting] = useState<boolean>(() => !optionsState['block-print']);
  const [allowCopying, setAllowCopying] = useState(true);
  const [allowModifying, setAllowModifying] = useState(false);
  const [allowAnnotating, setAllowAnnotating] = useState(false);

  const [inspection, setInspection] = useState<PdfEncryptionInspection | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const file = stagedFiles[0];
  const [prevFileId, setPrevFileId] = useState<string | undefined>(file?.id);

  if (file?.id !== prevFileId) {
    setPrevFileId(file?.id);
    setInspection(null);
    setValidationError(null);
    setPassword('');
    setConfirmPassword('');
    setAlgorithm('AES-256');
    setAllowPrinting(!optionsState['block-print']);
    setAllowCopying(true);
    setAllowModifying(false);
    setAllowAnnotating(false);
  }

  // Check if incoming staged document is already encrypted, unsupported, or corrupt
  useEffect(() => {
    let active = true;
    if (file?.bytes) {
      void inspectPdfEncryption(file.bytes).then((result) => {
        if (!active) return;
        setInspection(result);
      });
    }
    return () => {
      active = false;
    };
  }, [file?.bytes]);

  const strength = computePasswordStrength(password);
  const passwordsMatch = confirmPassword.length === 0 || password === confirmPassword;
  const rc4UnsupportedChars = algorithm === 'RC4' && password.length > 0 && !isAsciiPassword(password);
  const isFormValid =
    password.trim().length > 0 &&
    (confirmPassword.length === 0 || password === confirmPassword) &&
    !rc4UnsupportedChars &&
    inspection?.status === 'not-encrypted';

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
        className="card tp-work"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Lock size={18} style={{ color: 'var(--accent)' }} />
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Set Document Password</h3>
        </div>

        {/* Already encrypted / unsupported / corrupt warning banners */}
        {inspection?.status === 'encrypted' && (
          <NoticeBanner
            variant="danger"
            role="alert"
            icon={<ShieldAlert size={18} />}
          >
            <strong>Document is already protected:</strong> This PDF is already password protected. Unlock it first before applying new protection.
          </NoticeBanner>
        )}

        {inspection?.status === 'unsupported' && (
          <NoticeBanner
            variant="danger"
            role="alert"
            icon={<ShieldAlert size={18} />}
          >
            <strong>Unsupported existing encryption:</strong> {inspection.message}. Re-protecting an already encrypted file is not supported.
          </NoticeBanner>
        )}

        {inspection?.status === 'corrupt' && (
          <NoticeBanner
            variant="danger"
            role="alert"
            icon={<ShieldAlert size={18} />}
          >
            <strong>Unable to inspect PDF:</strong> {inspection.message}
          </NoticeBanner>
        )}

        {rc4UnsupportedChars && (
          <NoticeBanner variant="warning" role="alert">
            <strong>RC4-128 supports ASCII passwords only:</strong> Switch to <strong>AES-256 (Modern)</strong> for accented, non-English, or symbol characters so the document can always be unlocked reliably.
          </NoticeBanner>
        )}

        {/* Validation error banner */}
        {validationError && (
          <NoticeBanner variant="danger" role="alert">
            {validationError}
          </NoticeBanner>
        )}

        {/* Password input field */}
        <PasswordInput
          id={passwordInputId}
          label="Document Password"
          required
          value={password}
          onChange={handlePasswordChange}
          placeholder="Enter password to open this PDF"
          autoComplete="new-password"
        >
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
        </PasswordInput>

        {/* Confirm password input field */}
        <PasswordInput
          id={confirmPasswordInputId}
          label="Confirm Password"
          value={confirmPassword}
          onChange={handleConfirmPasswordChange}
          placeholder="Re-enter password to confirm"
          autoComplete="new-password"
          showPasswordLabel="Show confirm password"
          hidePasswordLabel="Hide confirm password"
          error={!passwordsMatch ? 'Passwords do not match' : undefined}
        />

        {/* Client-Side Security Assurance Notice */}
        <NoticeBanner
          variant="info"
          icon={<ShieldCheck size={16} style={{ color: 'var(--accent)' }} />}
          style={{ marginTop: 'auto' }}
        >
          <div>
            <strong>Client-Side Local Encryption:</strong> Your document is encrypted directly in your browser.
            The password is never transmitted to any server. Keep your password safe: there is no recovery option if forgotten.
          </div>
        </NoticeBanner>
      </div>

      {/* Right Column: Security Options & Action */}
      <div className="card opts">
        {/* Encryption Algorithm Selection */}
        <div>
          <label id="protect-algo-label" style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
            Encryption Algorithm
          </label>
          <SegmentedControl<'AES-256' | 'RC4'>
            ariaLabelledBy="protect-algo-label"
            size="sm"
            value={algorithm}
            onChange={setAlgorithm}
            options={[
              { value: 'AES-256', label: 'AES-256 (Modern)' },
              { value: 'RC4', label: 'RC4-128 (Legacy)' },
            ]}
          />
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

          <p style={{ margin: '2px 0 0', fontSize: '11.5px', lineHeight: 1.45, color: 'var(--text-muted)' }}>
            Permission flags (such as disabling copy or print) are enforced by InTabPDF and compliant viewers, but are not DRM and external extraction tools may ignore them. You can still unlock this PDF with your password.
          </p>
        </div>

        {/* Output filename input */}
        <div className="opts-filename">
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
