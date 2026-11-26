// Pure core operation for unlocking password-protected PDF documents.
import { decryptPDF } from '@pdfsmaller/pdf-decrypt';
import { PDFDocument } from 'pdf-lib';
import { inspectPdfEncryption } from './pdfEncryptionStatus';

export interface UnlockPdfOptions {
  password: string;
}

/**
 * Decrypts a password-protected PDF document.
 *
 * Verifies that the document is encrypted, validates the password, removes
 * encryption, and verifies output document integrity.
 */
export async function unlockPdf(
  pdfBytes: Uint8Array,
  options: UnlockPdfOptions,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (signal?.aborted) {
    throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
  }

  if (!pdfBytes || pdfBytes.byteLength === 0) {
    throw new Error('No PDF bytes provided to unlock.');
  }

  // Quick header validation
  const header = String.fromCharCode(...pdfBytes.subarray(0, 5));
  if (header !== '%PDF-') {
    throw new Error('Invalid PDF: file does not start with %PDF- header.');
  }

  if (typeof options?.password !== 'string') {
    throw new Error('Password must be provided to unlock.');
  }

  // Check if document is encrypted (distinguishing unsupported variants and corrupt files)
  const inspection = await inspectPdfEncryption(pdfBytes);
  if (inspection.status === 'not-encrypted') {
    throw new Error('This PDF is not password protected.');
  }
  if (inspection.status === 'unsupported') {
    throw new Error(
      `This PDF uses an unsupported encryption variant (${inspection.message}). Client-side decryption supports RC4 and AES-256.`,
    );
  }
  if (inspection.status === 'corrupt') {
    throw new Error(`Invalid or corrupt PDF: ${inspection.message}`);
  }

  if (signal?.aborted) {
    throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
  }

  let decrypted: Uint8Array;
  try {
    decrypted = await decryptPDF(pdfBytes, options.password);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('incorrect password')) {
      throw new Error(
        'Incorrect password. Please verify the password and try again.',
        { cause: error },
      );
    }

    // Check if failure is due to encrypted object streams (/ObjStm)
    const latinHeader = new TextDecoder('latin1').decode(
      pdfBytes.subarray(0, Math.min(pdfBytes.byteLength, 65536)),
    );
    if (
      latinHeader.includes('/ObjStm') &&
      (message.includes('PDFDict') || message.includes('undefined') || message.includes('parse'))
    ) {
      throw new Error(
        'This PDF uses encrypted object streams (/ObjStm), which is not supported by client-side decryption.',
        { cause: error },
      );
    }

    if (message.toLowerCase().includes('unsupported encryption')) {
      throw new Error(
        'This PDF uses an unsupported encryption variant or security handler.',
        { cause: error },
      );
    }

    throw new Error(
      `Failed to decrypt PDF: ${message}`,
      { cause: error },
    );
  }

  if (signal?.aborted) {
    throw signal.reason || new DOMException('Operation was aborted.', 'AbortError');
  }

  // Validate structural integrity of unlocked document
  try {
    const doc = await PDFDocument.load(decrypted);
    if (doc.getPageCount() === 0) {
      throw new Error('Unlocked PDF contains zero pages.');
    }
  } catch (validationErr) {
    throw new Error(
      'Decrypted document is structurally invalid or corrupt.',
      { cause: validationErr },
    );
  }

  return decrypted;
}
