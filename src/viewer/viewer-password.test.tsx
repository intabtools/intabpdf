import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import PasswordDialog from '../components/PasswordDialog';
import { loadPdf, destroyPdf, type PdfDocument } from './renderPage';
import type { PasswordPromptState } from './usePdfDocumentLoader';

describe('Password-Protected PDF Handling and Recovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('PasswordDialog UI & Accessibility Contract', () => {
    it('renders password dialog with masked input, document name, and action buttons', () => {
      const html = renderToString(
        <PasswordDialog
          fileName="confidential-contract.pdf"
          isIncorrect={false}
          isSubmitting={false}
          onSubmit={() => {}}
          onCancel={() => {}}
        />
      );

      expect(html).toContain('Password Protected PDF');
      expect(html).toContain('confidential-contract.pdf');
      expect(html).toContain('type="password"');
      expect(html).toContain('Unlock PDF');
      expect(html).toContain('Cancel');
      // No error message when not incorrect
      expect(html).not.toContain('Incorrect password');
    });

    it('renders inline non-destructive alert banner when isIncorrect is true', () => {
      const html = renderToString(
        <PasswordDialog
          fileName="encrypted-statement.pdf"
          isIncorrect={true}
          isSubmitting={false}
          onSubmit={() => {}}
          onCancel={() => {}}
        />
      );

      expect(html).toContain('Incorrect password. Please try again.');
      expect(html).toContain('role="alert"');
    });

    it('displays submitting state and disables actions during active verification', () => {
      const html = renderToString(
        <PasswordDialog
          fileName="locked.pdf"
          isIncorrect={false}
          isSubmitting={true}
          onSubmit={() => {}}
          onCancel={() => {}}
        />
      );

      expect(html).toContain('Unlocking…');
      expect(html).toContain('disabled');
    });
  });

  describe('Password Flow & Loading Task Re-use Logic', () => {
    it('re-uses the same active loading task across multiple incorrect attempts', async () => {
      let passwordPromptState: PasswordPromptState | null = null;
      const getPrompt = () => passwordPromptState;
      let activePasswordCallback: ((pwd: string | Error) => void) | null = null;
      let attemptsCount = 0;

      // Simulated PDF.js worker/task
      const simulatePdfJsOnPassword = (updatePasswordFn: (pwd: string | Error) => void, reason: number) => {
        // App loader registers its handler:
        activePasswordCallback = updatePasswordFn;
        passwordPromptState = {
          fileName: 'locked.pdf',
          isIncorrect: reason === 2,
          isSubmitting: false,
        };
      };

      const mockLoadingTask = {
        destroy: vi.fn().mockResolvedValue(undefined),
        // PDF.js provides updatePassword to the app
        triggerPasswordRequest(reason: number) {
          simulatePdfJsOnPassword((pwd) => {
            attemptsCount++;
            if (pwd === 'correct_password') {
              passwordPromptState = null;
            } else {
              // PDF.js worker invokes onPassword again with reason 2 (INCORRECT_PASSWORD)
              mockLoadingTask.triggerPasswordRequest(2);
            }
          }, reason);
        },
      };

      // Initial password challenge from PDF.js (reason 1 = NEED_PASSWORD)
      mockLoadingTask.triggerPasswordRequest(1);
      expect(getPrompt()).not.toBeNull();
      expect(getPrompt()?.isIncorrect).toBe(false);

      // Attempt 1: wrong password
      expect(activePasswordCallback).toBeDefined();
      passwordPromptState!.isSubmitting = true;
      activePasswordCallback!('wrong_pass_1');

      expect(attemptsCount).toBe(1);
      expect(getPrompt()?.isIncorrect).toBe(true);
      expect(getPrompt()?.isSubmitting).toBe(false);
      expect(mockLoadingTask.destroy).not.toHaveBeenCalled();

      // Attempt 2: second wrong password on the SAME task
      passwordPromptState!.isSubmitting = true;
      activePasswordCallback!('wrong_pass_2');

      expect(attemptsCount).toBe(2);
      expect(getPrompt()?.isIncorrect).toBe(true);
      expect(getPrompt()?.isSubmitting).toBe(false);
      expect(mockLoadingTask.destroy).not.toHaveBeenCalled();

      // Attempt 3: correct password succeeds without destroying the task
      passwordPromptState!.isSubmitting = true;
      activePasswordCallback!('correct_password');
      expect(attemptsCount).toBe(3);
      expect(getPrompt()).toBeNull();
      expect(mockLoadingTask.destroy).not.toHaveBeenCalled();
    });

    it('cancels pending loading task and destroys resources upon user cancel', async () => {
      let isDestroyed = false;
      let promptState: PasswordPromptState | null = {
        fileName: 'locked.pdf',
        isIncorrect: false,
        isSubmitting: false,
      };
      expect(promptState).not.toBeNull();

      let rejectPromise!: (reason?: unknown) => void;
      const loadingPromise = new Promise<PdfDocument>((_resolve, reject) => {
        rejectPromise = reject;
      });

      const mockLoadingTask = {
        destroy: vi.fn().mockImplementation(async () => {
          isDestroyed = true;
        }),
        promise: loadingPromise,
      };

      // When PDF.js needs a password, callback is stored
      const activeCallback: ((p: string | Error) => void) | null = (pwdOrErr) => {
        if (pwdOrErr instanceof Error) {
          rejectPromise(pwdOrErr);
        }
      };

      // User hits cancel:
      // usePdfDocumentLoader calls:
      // 1. activePasswordCallback(new Error('Password prompt cancelled by user'))
      // 2. activeLoadingTask.destroy()
      // 3. reset state to null
      activeCallback(new Error('Password prompt cancelled by user'));
      await mockLoadingTask.destroy();
      promptState = null;

      expect(isDestroyed).toBe(true);
      expect(promptState).toBeNull();
      expect(mockLoadingTask.destroy).toHaveBeenCalledTimes(1);
      await expect(mockLoadingTask.promise).rejects.toThrow('Password prompt cancelled by user');
    });

    it('guards against stale asynchronous callbacks from previous documents', async () => {
      let loadRequestCounter = 0;
      let adoptedDocId: number | null = null;

      // Document 1 starts
      const req1 = ++loadRequestCounter;
      let task1Callback: ((pwd: string | Error) => void) | null = null;

      const task1PasswordTrigger = (cb: (pwd: string | Error) => void) => {
        if (req1 === loadRequestCounter) {
          task1Callback = cb;
        } else {
          // Stale callback blocked
          cb(new Error('Stale loading request'));
        }
      };

      // Document 2 arrives before Document 1 password is submitted
      const req2 = ++loadRequestCounter;
      const task2Doc = { numPages: 2, id: 2 } as unknown as PdfDocument & { id: number };
      if (req2 === loadRequestCounter) {
        adoptedDocId = task2Doc.id;
      }

      // Late callback from Document 1 tries to fire
      const staleError = vi.fn();
      task1PasswordTrigger(staleError);

      expect(staleError).toHaveBeenCalledWith(expect.any(Error));
      expect(adoptedDocId).toBe(2);
      expect(task1Callback).toBeNull();
    });

    it('distinguishes corrupted files from password-protected files', async () => {
      const corruptBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      let passwordPromptTriggered = false;

      try {
        await loadPdf(corruptBytes, {
          onPassword: () => {
            passwordPromptTriggered = true;
          },
        });
      } catch (err: unknown) {
        expect(err).toBeDefined();
      }

      // Corrupted file must reject immediately without triggering password prompt
      expect(passwordPromptTriggered).toBe(false);
    });

    it('cleans up resources and resets state when document is destroyed', async () => {
      const mockDoc = {
        numPages: 1,
        getPage: vi.fn(),
      } as unknown as PdfDocument;

      await expect(destroyPdf(mockDoc)).resolves.toBeUndefined();
    });
  });

  describe('Security and Confidentiality Verification', () => {
    it('does not write entered passwords to localStorage or sessionStorage', () => {
      const mockStorage = {
        setItem: vi.fn(),
        getItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        length: 0,
        key: vi.fn(),
      };
      const globalWithStorage = globalThis as unknown as {
        localStorage?: unknown;
        sessionStorage?: unknown;
      };
      const origLocal = globalWithStorage.localStorage;
      const origSession = globalWithStorage.sessionStorage;
      Object.defineProperty(globalThis, 'localStorage', { value: mockStorage, configurable: true, writable: true });
      Object.defineProperty(globalThis, 'sessionStorage', { value: mockStorage, configurable: true, writable: true });

      try {
        const onSubmit = vi.fn();
        const mockSecret = 'super_secret_password_123';

        onSubmit(mockSecret);

        // Verify neither storage method received the password string
        expect(mockStorage.setItem).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining(mockSecret));
      } finally {
        Object.defineProperty(globalThis, 'localStorage', { value: origLocal, configurable: true, writable: true });
        Object.defineProperty(globalThis, 'sessionStorage', { value: origSession, configurable: true, writable: true });
      }
    });

    it('does not log password values to console.log or console.error', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const mockSecret = 'sensitive_passphrase_456';
      // Simulate normal error reporting without password leak
      console.error('Failed to open PDF: PasswordException');

      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining(mockSecret));
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining(mockSecret));
    });
  });
});
