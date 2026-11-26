// Shared PDF encryption inspection helper classifying plain, encrypted, unsupported, and corrupt inputs.
import { isEncrypted } from '@pdfsmaller/pdf-decrypt';

export type PdfEncryptionInspection =
  | { status: 'not-encrypted' }
  | {
      status: 'encrypted';
      algorithm?: 'AES-256' | 'RC4' | string;
      version?: number;
      revision?: number;
      keyLength?: number;
    }
  | {
      status: 'unsupported';
      message: string;
      version?: number;
      revision?: number;
    }
  | {
      status: 'corrupt';
      message: string;
    };

/**
 * Inspects PDF bytes to determine encryption status without swallowing detection failures.
 * Unsupported encryption schemes (e.g., AES-128 V=4/R=4) or corrupt headers/xrefs are explicitly distinguished
 * from unencrypted documents.
 */
export async function inspectPdfEncryption(pdfBytes: Uint8Array): Promise<PdfEncryptionInspection> {
  if (!pdfBytes || pdfBytes.byteLength < 5) {
    return {
      status: 'corrupt',
      message: 'Document is empty or not a valid PDF file.',
    };
  }

  const header = String.fromCharCode(...pdfBytes.subarray(0, 5));
  if (header !== '%PDF-') {
    return {
      status: 'corrupt',
      message: 'File does not start with a valid %PDF- header.',
    };
  }

  try {
    const info = await isEncrypted(pdfBytes);
    if (!info.encrypted) {
      return { status: 'not-encrypted' };
    }
    return {
      status: 'encrypted',
      algorithm: info.algorithm,
      version: info.version,
      revision: info.revision,
      keyLength: info.keyLength,
    };
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const cleaned = rawMessage.replace(/^Failed to read PDF:\s*/i, '').trim();

    if (/unsupported encryption/i.test(rawMessage)) {
      const match = rawMessage.match(/V=(\d+)(?:\s*,\s*R=(\d+))?/i);
      return {
        status: 'unsupported',
        message: cleaned,
        version: match ? parseInt(match[1], 10) : undefined,
        revision: match && match[2] ? parseInt(match[2], 10) : undefined,
      };
    }

    return {
      status: 'corrupt',
      message: cleaned || 'Unable to inspect PDF encryption dictionary.',
    };
  }
}
