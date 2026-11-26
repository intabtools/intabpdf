// Pure core operation for password-protecting PDF documents.
import {
  encryptPDF,
  type EncryptPDFOptions,
  AlreadyEncryptedError,
  PasswordEncodingError,
} from '@pdfsmaller/pdf-encrypt';
import { inspectPdfEncryption } from './pdfEncryptionStatus';

export interface ProtectPdfOptions {
  password: string;
  confirmPassword?: string;
  ownerPassword?: string;
  algorithm?: 'AES-256' | 'RC4';
  allowPrinting?: boolean;
  allowModifying?: boolean;
  allowCopying?: boolean;
  allowExtraction?: boolean;
  allowAnnotating?: boolean;
}

export function isAsciiPassword(password: string): boolean {
  for (let i = 0; i < password.length; i += 1) {
    if (password.charCodeAt(i) > 0x7f) {
      return false;
    }
  }
  return true;
}

function generateSecureOwnerPassword(): string {
  const bytes = new Uint8Array(24);
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Cryptographically secure random generator is unavailable to create an owner password.');
  }
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Encrypts a PDF document with a user password.
 *
 * Checks if the document is already encrypted, validates options, and applies
 * AES-256 (default) or RC4-128 standard PDF encryption.
 * When permissions are restricted without an explicit ownerPassword, a distinct
 * cryptographically random owner password is generated so compliant viewers enforce
 * user-level restrictions while keeping Unlock functional with the user password.
 */
export async function protectPdf(
  pdfBytes: Uint8Array,
  options: ProtectPdfOptions,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (signal?.aborted) {
    throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
  }

  if (!pdfBytes || pdfBytes.byteLength === 0) {
    throw new Error('No PDF bytes provided to protect.');
  }

  // Quick header validation
  const header = String.fromCharCode(...pdfBytes.subarray(0, 5));
  if (header !== '%PDF-') {
    throw new Error('Invalid PDF: file does not start with %PDF- header.');
  }

  if (!options?.password || options.password.trim().length === 0) {
    throw new Error('Password cannot be empty.');
  }

  if (options.confirmPassword !== undefined && options.password !== options.confirmPassword) {
    throw new Error('Passwords do not match.');
  }

  const algorithm = options.algorithm || 'AES-256';
  if (algorithm === 'RC4' && !isAsciiPassword(options.password)) {
    throw new Error(
      'RC4-128 only supports standard ASCII characters cleanly across viewers and unlocking. Please select AES-256 for accented or Unicode passwords.',
    );
  }
  if (algorithm === 'RC4' && options.ownerPassword && !isAsciiPassword(options.ownerPassword)) {
    throw new Error(
      'RC4-128 owner password only supports standard ASCII characters. Please select AES-256 for Unicode passwords.',
    );
  }

  // Check if document is already encrypted (or unsupported/corrupt)
  const inspection = await inspectPdfEncryption(pdfBytes);
  if (inspection.status === 'encrypted') {
    throw new Error('This PDF is already password protected. Unlock it first before applying new protection.');
  }
  if (inspection.status === 'unsupported') {
    throw new Error(`This PDF uses an unsupported encryption variant (${inspection.message}) and cannot be re-encrypted.`);
  }
  if (inspection.status === 'corrupt') {
    throw new Error(`Invalid or corrupt PDF: ${inspection.message}`);
  }

  if (signal?.aborted) {
    throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
  }

  const allowPrinting = options.allowPrinting ?? true;
  const allowCopying = options.allowCopying ?? true;
  const allowExtraction = options.allowExtraction ?? allowCopying;
  const allowModifying = options.allowModifying ?? false;
  const allowAnnotating = options.allowAnnotating ?? false;

  const hasRestrictions =
    !allowPrinting || !allowCopying || !allowExtraction || !allowModifying || !allowAnnotating;

  const ownerPassword =
    options.ownerPassword && options.ownerPassword.trim().length > 0
      ? options.ownerPassword
      : hasRestrictions
        ? generateSecureOwnerPassword()
        : undefined;

  const encryptOptions: EncryptPDFOptions = {
    algorithm,
    ...(ownerPassword ? { ownerPassword } : {}),
    allowPrinting,
    allowCopying,
    allowExtraction,
    allowModifying,
    allowAnnotating,
  };

  try {
    const encrypted = await encryptPDF(pdfBytes, options.password, encryptOptions);

    if (signal?.aborted) {
      throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
    }

    return encrypted;
  } catch (error) {
    if (error instanceof AlreadyEncryptedError) {
      throw new Error(
        'This PDF is already password protected. Unlock it first before applying new protection.',
        { cause: error },
      );
    }
    if (error instanceof PasswordEncodingError) {
      throw new Error(
        'Password contains characters that cannot be encoded with the selected encryption algorithm.',
        { cause: error },
      );
    }
    throw error;
  }
}
