/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { TOOLS } from '../tools/toolDefinitions';

describe('SEO, Discoverability, and Web Metadata Audit', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const indexHtmlPath = path.join(rootDir, 'index.html');
  const robotsPath = path.join(rootDir, 'public/robots.txt');
  const sitemapPath = path.join(rootDir, 'public/sitemap.xml');
  const redirectsPath = path.join(rootDir, 'public/_redirects');

  it('validates index.html metadata, viewport, and Open Graph tags', () => {
    expect(fs.existsSync(indexHtmlPath)).toBe(true);
    const html = fs.readFileSync(indexHtmlPath, 'utf8');

    // Title & Charset & Viewport
    expect(html).toContain('<meta charset="UTF-8" />');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0" />');
    expect(html).toContain('<title>InTabPDF : Privacy-First PDF Tools That Never Leave Your Device</title>');

    // Meta Description & Keywords
    expect(html).toContain('name="description"');
    expect(html).toContain('Merge, split, compress, rotate, and convert PDFs directly in your browser.');
    expect(html).toContain('100% client-side with zero uploads, no accounts, and no tracking.');
    expect(html).toContain('name="keywords"');

    // Theme Color & Icons
    expect(html).toContain('name="theme-color"');
    expect(html).toContain('rel="icon" type="image/svg+xml" href="/favicon.svg"');
    expect(html).toContain('rel="apple-touch-icon" href="/favicon.svg"');

    // Open Graph / Social Sharing
    expect(html).toContain('property="og:type" content="website"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:description"');
    expect(html).toContain('property="og:image" content="/favicon.svg"');
    expect(html).toContain('name="twitter:card" content="summary"');

    // No accidental noindex tag
    expect(html).not.toContain('noindex');
    expect(html).not.toContain('nofollow');

    // Noscript fallback for non-JS crawlers
    expect(html).toContain('<noscript>');
    expect(html).toContain('InTabPDF : Privacy-First PDF Tools');
    expect(html).toContain('JavaScript is required to run the local PDF tools.');
  });

  it('validates schema.org JSON-LD structured data', () => {
    const html = fs.readFileSync(indexHtmlPath, 'utf8');
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(jsonLdMatch).not.toBeNull();

    const jsonLd = JSON.parse(jsonLdMatch![1]);
    expect(jsonLd['@context']).toBe('https://schema.org');
    expect(jsonLd['@type']).toBe('WebApplication');
    expect(jsonLd.name).toBe('InTabPDF');
    expect(jsonLd.applicationCategory).toBe('UtilityApplication');
    expect(jsonLd.isAccessibleForFree).toBe(true);
    expect(jsonLd.offers?.price).toBe('0');
    expect(jsonLd.author?.name).toBe('intabtools');

    // Available tools in feature list
    expect(jsonLd.featureList).toContain('Merge PDF');
    expect(jsonLd.featureList).toContain('Split PDF');
    expect(jsonLd.featureList).toContain('Compress PDF');
    expect(jsonLd.featureList).toContain('Rotate PDF');
    expect(jsonLd.featureList).toContain('Remove Pages');
    expect(jsonLd.featureList).toContain('Images to PDF');

    // Ensure no unsupported aggregate ratings or invented metrics
    expect(jsonLd.aggregateRating).toBeUndefined();
  });

  it('validates robots.txt configuration', () => {
    expect(fs.existsSync(robotsPath)).toBe(true);
    const robots = fs.readFileSync(robotsPath, 'utf8');

    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Allow: /');
    expect(robots).not.toContain('Disallow: /');
  });

  it('validates sitemap.xml structure and canonical route alignment', () => {
    expect(fs.existsSync(sitemapPath)).toBe(true);
    const sitemap = fs.readFileSync(sitemapPath, 'utf8');

    expect(sitemap).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(sitemap).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

    // Indexable routes
    expect(sitemap).toContain('<loc>https://intabpdf.pages.dev/</loc>');
    expect(sitemap).toContain('<loc>https://intabpdf.pages.dev/about</loc>');

    // Available tools must be present
    const availableTools = TOOLS.filter((t) => t.availability === 'available');
    for (const tool of availableTools) {
      expect(sitemap).toContain(`<loc>https://intabpdf.pages.dev/tool/${tool.id}</loc>`);
    }

    // Coming-soon tools must NOT be indexed
    const comingSoonTools = TOOLS.filter((t) => t.availability === 'coming-soon');
    for (const tool of comingSoonTools) {
      expect(sitemap).not.toContain(`/tool/${tool.id}</loc>`);
    }

    // Standalone viewer route is disabled on web and must not be in sitemap
    expect(sitemap).not.toContain('/viewer</loc>');
  });

  it('validates Cloudflare Pages _redirects SPA rewrite rule', () => {
    expect(fs.existsSync(redirectsPath)).toBe(true);
    const redirects = fs.readFileSync(redirectsPath, 'utf8');
    expect(redirects).toContain('/* /index.html 200');
  });
});
