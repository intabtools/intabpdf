// Polyfills for modern ECMAScript features required by pdfjs-dist v6 in older WebViews and Node.js test environments.
const g = globalThis as unknown as {
  Iterator?: unknown;
};

if (typeof g.Iterator === 'undefined') {
  g.Iterator = class {};
}

const P = Promise as unknown as {
  withResolvers?: <T>() => {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
  try?: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown>;
};

if (!P.withResolvers) {
  P.withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

if (!P.try) {
  P.try = function (fn, ...args) {
    return new Promise((resolve) => resolve(fn(...args)));
  };
}

const U8Proto = Uint8Array.prototype as unknown as {
  toHex?: () => string;
};

if (!U8Proto.toHex) {
  U8Proto.toHex = function (this: Uint8Array) {
    return Array.from(this)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  };
}
