// Pure core operation for password-protecting PDF documents.
import {
  encryptPDF,
  type EncryptPDFOptions,
  AlreadyEncryptedError,
  PasswordEncodingError,
} from '@pdfsmaller/pdf-encrypt';
import { isEncrypted } from '@pdfsmaller/pdf-decrypt';

export interface ProtectPdfOptions {
  password: string;
  confirmPassword?: string;
  algorithm?: 'AES-256' | 'RC4';
  allowPrinting?: boolean;
  allowModifying?: boolean;
  allowCopying?: boolean;
  allowAnnotating?: boolean;
}

/**
 * Encrypts a PDF document with a user password.
 *
 * Checks if the document is already encrypted, validates options, and applies
 * AES-256 (default) or RC4-128 standard PDF encryption.
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

  // Check if document is already encrypted
  const encStatus = await isEncrypted(pdfBytes);
  if (encStatus.encrypted) {
    throw new Error('This PDF is already password protected. Unlock it first before applying new protection.');
  }

  if (signal?.aborted) {
    throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
  }

  const encryptOptions: EncryptPDFOptions = {
    algorithm: options.algorithm || 'AES-256',
    allowPrinting: options.allowPrinting ?? true,
    allowCopying: options.allowCopying ?? true,
    allowModifying: options.allowModifying ?? false,
    allowAnnotating: options.allowAnnotating ?? false,
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
