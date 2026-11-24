// Tool module for removing passwords and unlocking protected PDF documents locally.
import { useEffect, useId, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { AlertCircle, Eye, EyeOff, Lock, ShieldCheck, Unlock } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import type { ToolComponentProps } from '../types';
import type { UnlockPdfOptions } from '../../core/unlock';
import { isEncrypted } from '@pdfsmaller/pdf-decrypt';
import { pdfProcessingService } from '../../core/worker/service';

export default function UnlockTool({
  stagedFiles,
  onExecute,
  isProcessing,
  outputBaseName,
  onOutputBaseNameChange,
  defaultBaseName,
  outputExtension,
}: ToolComponentProps): ReactNode {
  const passwordInputId = useId();

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isDocEncrypted, setIsDocEncrypted] = useState<boolean | null>(null);
  const [detectedAlgorithm, setDetectedAlgorithm] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const file = stagedFiles[0];
  const [prevFileId, setPrevFileId] = useState<string | undefined>(file?.id);

  if (file?.id !== prevFileId) {
    setPrevFileId(file?.id);
    setIsDocEncrypted(null);
    setDetectedAlgorithm(null);
    setErrorMessage(null);
    setPassword('');
  }

  // Detect encryption status whenever staged document changes
  useEffect(() => {
    let active = true;
    if (file?.bytes) {
      void isEncrypted(file.bytes).then(
        (status) => {
          if (!active) return;
          setIsDocEncrypted(status.encrypted);
          setDetectedAlgorithm(status.algorithm || null);
        },
        () => {
          if (!active) return;
          setIsDocEncrypted(false);
          setDetectedAlgorithm(null);
        }
      );
    }
    return () => {
      active = false;
    };
  }, [file?.bytes]);

  const handlePasswordChange = (e: ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    setErrorMessage(null);
  };

  const handleRun = async () => {
    if (!file?.bytes || password.length === 0 || isProcessing) return;

    const unlockOptions: UnlockPdfOptions = {
      password,
    };

    try {
      await onExecute(async (signal) => {
        return await pdfProcessingService.execute(
          'unlock',
          {
            buffer: file.bytes,
            options: unlockOptions,
          },
          { signal }
        );
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    }
  };

  const isFormValid = password.length > 0 && isDocEncrypted !== false;

  return (
    <>
      {/* Left Column: Password Entry & Document Status */}
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
          <Unlock size={18} style={{ color: 'var(--accent)' }} />
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Enter Document Password</h3>
        </div>

        {/* Protection detection badge */}
        {isDocEncrypted === true && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              fontSize: '12px',
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
            }}
          >
            <Lock size={15} style={{ flexShrink: 0, color: 'var(--accent)' }} />
            <span>
              Protected PDF detected {detectedAlgorithm ? `(${detectedAlgorithm})` : ''}. Enter the password to remove encryption.
            </span>
          </div>
        )}

        {isDocEncrypted === false && (
          <div
            role="alert"
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              fontSize: '12px',
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              color: 'var(--text-muted)',
            }}
          >
            <ShieldCheck size={16} style={{ flexShrink: 0, color: 'var(--accent)' }} />
            <span>
              This document is not password protected. Unlocking is not required.
            </span>
          </div>
        )}

        {/* Error message banner */}
        {errorMessage && (
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
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Password input */}
        <div>
          <label
            htmlFor={passwordInputId}
            style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}
          >
            Password <span style={{ color: 'var(--danger, #e53e3e)' }}>*</span>
          </label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              id={passwordInputId}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={handlePasswordChange}
              placeholder="Enter password to unlock document"
              autoComplete="current-password"
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
          <small style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '4px', display: 'block' }}>
            Enter either the user (open) password or owner (permissions) password.
          </small>
        </div>

        {/* Security assurance notice */}
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
            <strong>Client-Side Decryption:</strong> Unlocking is processed entirely on your local device.
            Your password and document contents are never transmitted to any external server.
          </div>
        </div>
      </div>

      {/* Right Column: Execution Options & Action */}
      <div className="card opts">
        <div>
          <span style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
            Permanent Removal
          </span>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            This operation strips encryption entirely and exports an unencrypted PDF that opens anywhere without asking for a password.
          </p>
        </div>

        {/* Output filename input */}
        <div style={{ marginTop: '8px', marginBottom: '8px' }}>
          <OutputFilenameInput
            value={outputBaseName ?? ''}
            onChange={onOutputBaseNameChange ?? (() => {})}
            placeholder={defaultBaseName ?? 'unlocked'}
            extension={outputExtension ?? '.pdf'}
          />
        </div>

        <button
          type="button"
          className="cta"
          onClick={handleRun}
          disabled={isProcessing || !file || !isFormValid}
        >
          <Unlock size={16} style={{ flexShrink: 0 }} />
          <span>{isProcessing ? 'Unlocking...' : 'Unlock PDF'}</span>
        </button>
      </div>
    </>
  );
}
