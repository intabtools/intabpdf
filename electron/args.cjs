const path = require('path');
const { fileURLToPath } = require('url');

// Parse incoming PDF command-line arguments on Linux and Windows.
// Handles file:// URLs (including percent-encoded paths like file:///path/to/my%20file.pdf)
// and normal file system paths.
function resolvePdfArg(arg) {
  if (typeof arg !== 'string') return null;
  const trimmed = arg.trim();
  if (!trimmed || trimmed.startsWith('--')) return null;

  let resolvedPath = trimmed;
  if (trimmed.startsWith('file://')) {
    try {
      resolvedPath = fileURLToPath(trimmed);
    } catch (err) {
      console.error('Failed to convert file URL to path:', trimmed, err);
      return null;
    }
  }

  if (resolvedPath.toLowerCase().endsWith('.pdf')) {
    return path.resolve(resolvedPath);
  }
  return null;
}

// argv[0] is the executable itself, so skip it.
const findPdf = (argv) => {
  if (!Array.isArray(argv)) return null;
  for (let i = 1; i < argv.length; i++) {
    const candidate = resolvePdfArg(argv[i]);
    if (candidate) return candidate;
  }
  return null;
};

module.exports = {
  resolvePdfArg,
  findPdf,
};
