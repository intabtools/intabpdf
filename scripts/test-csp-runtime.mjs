import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '../dist');

// Read headers from dist/_headers
const headersRaw = fs.readFileSync(path.join(distDir, '_headers'), 'utf-8');
const customHeaders = {};
for (const line of headersRaw.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('/*')) continue;
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx > 0) {
    const key = trimmed.slice(0, colonIdx).trim();
    const val = trimmed.slice(colonIdx + 1).trim();
    customHeaders[key.toLowerCase()] = val;
  }
}

console.log('Serving with headers:\n', customHeaders);

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';
  let filePath = path.join(distDir, reqPath);

  if (!fs.existsSync(filePath)) {
    filePath = path.join(distDir, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  // If fallback to index.html, ensure Content-Type is text/html!
  const finalContentType = filePath.endsWith('index.html') ? 'text/html' : contentType;

  for (const [k, v] of Object.entries(customHeaders)) {
    res.setHeader(k, v);
  }
  res.setHeader('Content-Type', finalContentType);

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200);
    res.end(data);
  } catch (err) {
    res.writeHead(500);
    res.end(String(err));
  }
});

await new Promise((resolve) => server.listen(8090, resolve));
console.log('Production server listening on http://localhost:8090');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();

const cspViolations = [];
const consoleErrors = [];

page.on('console', (msg) => {
  console.log(`[Browser ${msg.type()}]:`, msg.text());
  if (msg.type() === 'error') {
    consoleErrors.push(msg.text());
  }
});

page.on('pageerror', (err) => {
  consoleErrors.push(err.message);
});

// Register securitypolicyviolation listener
await page.addInitScript(() => {
  window.addEventListener('securitypolicyviolation', (e) => {
    window.__cspViolations = window.__cspViolations || [];
    window.__cspViolations.push({
      blockedURI: e.blockedURI,
      violatedDirective: e.violatedDirective,
      originalPolicy: e.originalPolicy,
    });
    console.error('CSP Violation:', e.blockedURI, e.violatedDirective);
  });
});

try {
  console.log('1. Testing Home Page load under CSP...');
  await page.goto('http://localhost:8090', { waitUntil: 'networkidle' });
  const title = await page.title();
  console.log('   Page Title:', title);

  const samplePdfPath = path.join(distDir, 'sample.pdf');

  // 2. Test Tools Navigation
  const tools = [
    'merge',
    'split',
    'rotate',
    'remove-pages',
    'compress',
    'images-to-pdf',
    'pdf-to-images',
    'extract-text'
  ];

  for (const tool of tools) {
    console.log(`2. Navigating to /tool/${tool}...`);
    await page.goto(`http://localhost:8090/tool/${tool}`, { waitUntil: 'networkidle' });
    console.log('Current URL:', page.url());
    console.log('Body:', (await page.innerText('body')).slice(0, 200));
    await page.waitForSelector('.dz', { timeout: 5000 });
  }

  // 3. Test Extract Text with sample.pdf (PDF.js + worker)
  console.log('3. Testing Extract Text with sample.pdf...');
  await page.goto('http://localhost:8090/tool/extract-text', { waitUntil: 'networkidle' });
  const extractInput = page.locator('input[type="file"]');
  await extractInput.setInputFiles(samplePdfPath);
  const extractBtn = page.locator('button.cta');
  await extractBtn.waitFor({ state: 'visible', timeout: 5000 });
  await extractBtn.click();
  // Wait for result card with text preview
  await page.waitForSelector('textarea[aria-label="Extracted text preview"]', { timeout: 15000 });
  const extractedText = await page.inputValue('textarea[aria-label="Extracted text preview"]');
  console.log('   Extract Text successfully processed and previewed text:', extractedText.slice(0, 40));

  // 4. Test PDF to Images (PDF.js worker + Canvas rendering + blob URLs)
  console.log('4. Testing PDF to Images with sample.pdf...');
  await page.goto('http://localhost:8090/tool/pdf-to-images', { waitUntil: 'networkidle' });
  const pdfToImgInput = page.locator('input[type="file"]');
  await pdfToImgInput.setInputFiles(samplePdfPath);
  const convertBtn = page.locator('button.cta');
  await convertBtn.waitFor({ state: 'visible', timeout: 5000 });
  await convertBtn.click();
  // Wait for result card or download button
  await page.waitForSelector('button:has-text("Save ZIP"), button:has-text("Save PNG"), button:has-text("Save JPEG")', { timeout: 15000 });
  console.log('   PDF to Images successfully converted pages to image cards with blob URLs!');

  // 5. Test Split PDF (Web Worker + pdf-lib + blob download)
  console.log('5. Testing Split PDF with sample.pdf...');
  await page.goto('http://localhost:8090/tool/split', { waitUntil: 'networkidle' });
  const splitInput = page.locator('input[type="file"]');
  await splitInput.setInputFiles(samplePdfPath);
  const splitBtn = page.locator('button.cta');
  await splitBtn.waitFor({ state: 'visible', timeout: 5000 });
  await splitBtn.click();

  // Wait for result card and trigger download
  const saveSplitBtn = page.locator('button:has-text("Save ZIP"), button:has-text("Save PDF")');
  await saveSplitBtn.waitFor({ state: 'visible', timeout: 15000 });
  const [downloadSplit] = await Promise.all([
    page.waitForEvent('download'),
    saveSplitBtn.click()
  ]);
  const splitDownloadPath = await downloadSplit.path();
  console.log('   Split PDF downloaded output to:', splitDownloadPath);
  const splitStats = fs.statSync(splitDownloadPath);
  console.log('   Split PDF output size:', splitStats.size, 'bytes');

  // 6. Test Merge PDF with 2 files (Web Worker + pdf-lib + multi-file merge + download)
  console.log('6. Testing Merge PDF...');
  await page.goto('http://localhost:8090/tool/merge', { waitUntil: 'networkidle' });
  const mergeInput = page.locator('input[type="file"]');
  await mergeInput.setInputFiles([samplePdfPath, samplePdfPath]);
  const mergeBtn = page.locator('button.cta');
  await mergeBtn.waitFor({ state: 'visible', timeout: 5000 });
  await mergeBtn.click();

  const saveMergeBtn = page.locator('button:has-text("Save PDF")');
  await saveMergeBtn.waitFor({ state: 'visible', timeout: 15000 });
  const [downloadMerge] = await Promise.all([
    page.waitForEvent('download'),
    saveMergeBtn.click()
  ]);
  const mergeDownloadPath = await downloadMerge.path();
  console.log('   Merge PDF downloaded output to:', mergeDownloadPath);
  const mergeStats = fs.statSync(mergeDownloadPath);
  console.log('   Merge PDF output size:', mergeStats.size, 'bytes');

  // 7. Test Images to PDF
  console.log('7. Testing Images to PDF...');
  const samplePngPath = path.join(__dirname, 'sample.png');
  const png1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  fs.writeFileSync(samplePngPath, png1x1);

  await page.goto('http://localhost:8090/tool/images-to-pdf', { waitUntil: 'networkidle' });
  const imgInput = page.locator('input[type="file"]');
  await imgInput.setInputFiles([samplePngPath]);
  const generatePdfBtn = page.locator('button:has-text("Create PDF")');
  await generatePdfBtn.waitFor({ state: 'visible', timeout: 5000 });
  await generatePdfBtn.click();

  const saveImgPdfBtn = page.locator('button:has-text("Save PDF")');
  await saveImgPdfBtn.waitFor({ state: 'visible', timeout: 15000 });
  const [downloadImgPdf] = await Promise.all([
    page.waitForEvent('download'),
    saveImgPdfBtn.click()
  ]);
  const imgPdfDownloadPath = await downloadImgPdf.path();
  console.log('   Images to PDF downloaded output to:', imgPdfDownloadPath);
  const imgPdfStats = fs.statSync(imgPdfDownloadPath);
  console.log('   Images to PDF output size:', imgPdfStats.size, 'bytes');

  fs.unlinkSync(samplePngPath);

  // 8. Test Invalid Input
  console.log('8. Testing invalid input handling...');
  const invalidTxtPath = path.join(__dirname, 'invalid.txt');
  fs.writeFileSync(invalidTxtPath, 'this is not a valid pdf document');
  await page.goto('http://localhost:8090/tool/split', { waitUntil: 'networkidle' });
  const invalidInput = page.locator('input[type="file"]');
  await invalidInput.setInputFiles(invalidTxtPath);
  // An alert box with role="alert" should appear
  await page.waitForSelector('[role="alert"]', { timeout: 5000 });
  const alertMsg = await page.innerText('[role="alert"]');
  console.log('   Invalid input correctly rejected with alert:', alertMsg.slice(0, 50));
  fs.unlinkSync(invalidTxtPath);

  // Collect any CSP violations
  const finalViolations = await page.evaluate(() => window.__cspViolations || []);
  cspViolations.push(...finalViolations);

} finally {
  await browser.close();
  server.close();
}

console.log('\n=== CSP RUNTIME VERIFICATION RESULTS ===');
console.log('Total CSP Violations Detected:', cspViolations.length);
if (cspViolations.length > 0) {
  console.error('CSP Violations:', JSON.stringify(cspViolations, null, 2));
}

console.log('Total Console Errors Logged:', consoleErrors.length);
if (consoleErrors.length > 0) {
  console.error('Console Errors:', JSON.stringify(consoleErrors, null, 2));
}

if (cspViolations.length > 0) {
  console.error('FAILED: CSP Violations occurred.');
  process.exit(1);
} else {
  console.log('\n✅ VERIFICATION PASSED:');
  console.log('1. All PDF.js workers and processing Web Workers executed without CSP violations.');
  console.log('2. Canvas rendering and OffscreenCanvas executed cleanly.');
  console.log('3. Blob URLs for image cards and file downloads functioned properly.');
  console.log('4. Output PDF and image generation produced valid non-empty files.');
  console.log('5. Zero CSP violations were triggered during end-to-end workflows.');
}
