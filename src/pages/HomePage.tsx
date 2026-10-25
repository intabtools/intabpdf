import type { MouseEvent, ReactNode } from 'react';
import { Check, Code2, Download, Lock } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import DropZone from '../components/DropZone';
import ToolIcon from '../components/ToolIcon';
import { useShell } from '../hooks/useShell';
import { useToast } from '../hooks/useToast';
import { useViewer } from '../hooks/useViewer';
import type { OpenedFile } from '../platform';
import { TOOL_CATEGORIES, getToolsByCategory, isToolImplemented } from '../tools/registry';

export default function HomePage(): ReactNode {
  const navigate = useNavigate();
  const { loadFile } = useViewer();
  const { shell } = useShell();
  const { showToast } = useToast();

  const handleToolClick = (_e: MouseEvent, toolId: string) => {
    if (!isToolImplemented(toolId)) {
      showToast('Coming soon — tool is under development');
    }
  };

  const handleFilesSelected = (files: OpenedFile[]) => {
    if (files.length > 0) {
      loadFile(files[0]);
      navigate('/viewer');
    }
  };

  if (shell === 'web') {
    return (
      <div className="wp">
        {/* Web Hero Section */}
        <section className="hero">
          <div>
            <h1>PDF tools that never leave your device</h1>
            <p className="sub2">
              Merge, split, compress and sign PDFs in your browser. No uploads and no account.
            </p>
            <div className="pills">
              <span>
                <Check size={14} strokeWidth={2.5} />
                No uploads
              </span>
              <span>
                <Check size={14} strokeWidth={2.5} />
                No account
              </span>
              <span>
                <Check size={14} strokeWidth={2.5} />
                No ads
              </span>
              <span>
                <Check size={14} strokeWidth={2.5} />
                Open source
              </span>
            </div>
          </div>

          <DropZone
            title="Drop PDF files here"
            subtitle="or choose files from your device"
            ctaText="Choose files"
            accept="application/pdf,.pdf"
            onFilesSelected={handleFilesSelected}
          />
        </section>

        {/* All Tools Catalog */}
        <h2 className="wsec">All tools</h2>
        <p className="wsub">Pick a tool, add your files, save the result.</p>

        {TOOL_CATEGORIES.map((category) => {
          const tools = getToolsByCategory(category);
          return (
            <div key={category}>
              <h3 className="wgl">{category}</h3>
              <div className="wgrid">
                {tools.map((tool) => (
                  <Link
                    key={tool.id}
                    to={`/tool/${tool.id}`}
                    onClick={(e) => handleToolClick(e, tool.id)}
                    className="tc"
                    aria-label={`${tool.name}: ${tool.description}`}
                  >
                    <span className="tci">
                      <ToolIcon name={tool.icon} size={22} />
                    </span>
                    <span>
                      <b>{tool.name}</b>
                      <small>{tool.description}</small>
                      {tool.availability === 'coming-soon' && (
                        <span className="badge-cs">Coming soon</span>
                      )}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}

        {/* Feature Highlights */}
        <div className="feat">
          <div>
            <span className="tci">
              <Lock size={22} />
            </span>
            <b>Stays on your device</b>
            <p>Files are processed in your browser. Nothing is uploaded to any server.</p>
          </div>
          <div>
            <span className="tci">
              <Code2 size={22} />
            </span>
            <b>Open source</b>
            <p>MIT licensed. Inspect every line of code on GitHub.</p>
          </div>
          <div>
            <span className="tci">
              <Check size={22} />
            </span>
            <b>Free and ad-free</b>
            <p>No account, no tracking, no subscription, and no sign-up required.</p>
          </div>
        </div>

        {/* Prefer an app download card */}
        <section className="dl wide">
          <div>
            <h2>Prefer an app?</h2>
            <p>InTab PDF also runs on Android and desktop. Same tools, same privacy.</p>
          </div>
          <div className="dlb">
            <a
              href="https://github.com/intabtools/intabpdf/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="cta o"
            >
              <Download size={16} />
              <span>Android APK</span>
            </a>
            <a
              href="https://github.com/intabtools/intabpdf/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="cta o"
            >
              <Download size={16} />
              <span>Windows installer</span>
            </a>
            <a
              href="https://github.com/intabtools/intabpdf/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="cta o"
            >
              <Download size={16} />
              <span>Linux</span>
            </a>
          </div>
        </section>
      </div>
    );
  }

  // App Shell Layout (Desktop Electron, Android, Tablet)
  return (
    <div className="cnt">
      <DropZone
        title="Open PDF files"
        subtitle="Choose files or drop them here."
        ctaText="Choose files"
        accept="application/pdf,.pdf"
        multiple={false}
        onFilesSelected={handleFilesSelected}
      />

      {TOOL_CATEGORIES.map((category) => {
        const categoryTools = getToolsByCategory(category);
        return (
          <section key={category}>
            <h2 className="sec">{category}</h2>
            <div className="idx">
              <div className="grid">
                {categoryTools.map((tool) => (
                  <Link
                    key={tool.id}
                    to={`/tool/${tool.id}`}
                    onClick={(e) => handleToolClick(e, tool.id)}
                    className="cell"
                    aria-label={`${tool.name}: ${tool.description}`}
                  >
                    <ToolIcon name={tool.icon} size={24} />
                    <span>
                      <b>{tool.name}</b>
                      <small>{tool.description}</small>
                      {tool.availability === 'coming-soon' && (
                        <span className="badge-cs">Coming soon</span>
                      )}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
