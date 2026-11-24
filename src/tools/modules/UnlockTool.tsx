// Tool module for removing passwords and unlocking protected PDF documents locally.
import { useEffect, useId, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { Lock, ShieldCheck, Unlock } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import PasswordInput from '../../components/PasswordInput';
import NoticeBanner from '../../components/NoticeBanner';
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
          <NoticeBanner
            variant="info"
            role="status"
            icon={<Lock size={15} style={{ color: 'var(--accent)' }} />}
          >
            Protected PDF detected {detectedAlgorithm ? `(${detectedAlgorithm})` : ''}. Enter the password to remove encryption.
          </NoticeBanner>
        )}

        {isDocEncrypted === false && (
          <NoticeBanner
            variant="info"
            role="status"
            icon={<ShieldCheck size={16} style={{ color: 'var(--accent)' }} />}
          >
            This document is not password protected. Unlocking is not required.
          </NoticeBanner>
        )}

        {/* Error message banner */}
        {errorMessage && (
          <NoticeBanner variant="danger" role="alert">
            {errorMessage}
          </NoticeBanner>
        )}

        {/* Password input */}
        <PasswordInput
          id={passwordInputId}
          label="Password"
          required
          value={password}
          onChange={handlePasswordChange}
          placeholder="Enter password to unlock document"
          autoComplete="current-password"
          helperText="Enter either the user (open) password or owner (permissions) password."
        />

        {/* Security assurance notice */}
        <NoticeBanner
          variant="info"
          icon={<ShieldCheck size={16} style={{ color: 'var(--accent)' }} />}
          style={{ marginTop: 'auto' }}
        >
          <div>
            <strong>Client-Side Decryption:</strong> Unlocking is processed entirely on your local device.
            Your password and document contents are never transmitted to any external server.
          </div>
        </NoticeBanner>
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
