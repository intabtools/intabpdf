// Tool module for removing passwords and unlocking protected PDF documents locally.
import { useEffect, useId, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { AlertTriangle, Lock, ShieldCheck, Unlock } from 'lucide-react';
import OutputFilenameInput from '../../components/OutputFilenameInput';
import PasswordInput from '../../components/PasswordInput';
import NoticeBanner from '../../components/NoticeBanner';
import type { ToolComponentProps } from '../types';
import type { UnlockPdfOptions } from '../../core/unlock';
import { inspectPdfEncryption, type PdfEncryptionInspection } from '../../core/pdfEncryptionStatus';
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
  const [inspection, setInspection] = useState<PdfEncryptionInspection | null>(null);

  const file = stagedFiles[0];
  const [prevFileId, setPrevFileId] = useState<string | undefined>(file?.id);

  if (file?.id !== prevFileId) {
    setPrevFileId(file?.id);
    setInspection(null);
    setPassword('');
  }

  // Detect encryption status whenever staged document changes
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

  const handlePasswordChange = (e: ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
  };

  const handleRun = async () => {
    if (!file?.bytes || inspection?.status !== 'encrypted' || isProcessing) return;

    const unlockOptions: UnlockPdfOptions = {
      password,
    };

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
  };

  const isFormValid = inspection?.status === 'encrypted';

  return (
    <>
      {/* Left Column: Password Entry & Document Status */}
      <div
        className="card tp-work"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Unlock size={18} style={{ color: 'var(--accent)' }} />
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Enter Document Password</h3>
        </div>

        {/* Protection detection badge */}
        {inspection?.status === 'encrypted' && (
          <NoticeBanner
            variant="info"
            role="status"
            icon={<Lock size={15} style={{ color: 'var(--accent)' }} />}
          >
            Protected PDF detected {inspection.algorithm ? `(${inspection.algorithm})` : ''}. Enter the password, or leave blank if only copying/printing permissions are restricted.
          </NoticeBanner>
        )}

        {inspection?.status === 'not-encrypted' && (
          <NoticeBanner
            variant="info"
            role="status"
            icon={<ShieldCheck size={16} style={{ color: 'var(--accent)' }} />}
          >
            This document is not password protected. Unlocking is not required.
          </NoticeBanner>
        )}

        {inspection?.status === 'unsupported' && (
          <NoticeBanner
            variant="danger"
            role="alert"
            icon={<AlertTriangle size={16} />}
          >
            <div>
              <strong>Unsupported encryption variant:</strong> {inspection.message}. Client-side unlocking supports RC4 (V=1–2) and AES-256 (V=5).
            </div>
          </NoticeBanner>
        )}

        {inspection?.status === 'corrupt' && (
          <NoticeBanner
            variant="danger"
            role="alert"
            icon={<AlertTriangle size={16} />}
          >
            <div>
              <strong>Unable to inspect PDF:</strong> {inspection.message}
            </div>
          </NoticeBanner>
        )}

        {/* Password input */}
        <PasswordInput
          id={passwordInputId}
          label="Password"
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
        <div className="opts-filename">
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
