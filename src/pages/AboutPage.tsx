import type { ReactNode } from 'react';
import { Code2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useShell } from '../hooks/useShell';

const FAQ_ITEMS = [
  {
    question: 'Are my files uploaded?',
    answer:
      'No. Every tool runs completely on your device. The app never sends your PDFs anywhere over the internet.',
  },
  {
    question: 'Does it work offline?',
    answer:
      'Yes. Once loaded, no internet connection is needed. The desktop and mobile apps work offline from the first launch.',
  },
  {
    question: 'Is there a size limit?',
    answer:
      'Only what your device can hold in memory. Very large files can take a few seconds on older devices, but processing remains private and local.',
  },
];

const PRIVACY_ITEMS = [
  { title: 'Uploads', detail: 'None. Files are processed on your device.' },
  { title: 'Account', detail: 'Not required.' },
  { title: 'Analytics', detail: 'None collected.' },
  { title: 'Ads', detail: 'None.' },
];

export default function AboutPage(): ReactNode {
  const { shell } = useShell();

  const content = (
    <div className="ab">
      <section className="card id">
        <h2>About InTab PDF</h2>
        <p>
          Privacy-first, open-source PDF toolkit built by students for everyone.
          Processes documents directly in your browser or native device shell.
        </p>
        <div className="btnrow">
          <a
            href="https://github.com/intabtools/intabpdf"
            target="_blank"
            rel="noopener noreferrer"
            className="cta"
          >
            <Code2 size={18} />
            <span>View source</span>
          </a>
          <small className="mu">Version 0.1.0, MIT license</small>
        </div>
      </section>

      <section className="card pr" aria-label="Privacy guarantees">
        {PRIVACY_ITEMS.map((item) => (
          <div key={item.title}>
            <span>
              <b>{item.title}</b>
              <small>{item.detail}</small>
            </span>
          </div>
        ))}
      </section>

      <p className="plat wide">
        Android: APK from GitHub releases
        <br />
        Windows: NSIS installer & ZIP
        <br />
        Linux: AppImage, DEB, and RPM
      </p>

      <section className="faq wide">
        <h2>Questions</h2>
        {FAQ_ITEMS.map((item) => (
          <details key={item.question}>
            <summary>{item.question}</summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </section>
    </div>
  );

  if (shell === 'web') {
    return (
      <div className="wp">
        <nav className="bc" aria-label="Breadcrumb">
          <Link to="/">All tools</Link>
          <span aria-hidden="true">/</span>
          <b>About</b>
        </nav>
        {content}
      </div>
    );
  }

  return <div className="cnt">{content}</div>;
}
