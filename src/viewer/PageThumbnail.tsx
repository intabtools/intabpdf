// Component for rendering an individual page thumbnail in the viewer thumbnail rail.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { drawPageOnCanvas } from './renderPage';
import type { PageThumbnailProps } from './types';

export default function PageThumbnail({
  doc,
  pageNumber,
  baseSize,
  isActive,
  onClick,
}: PageThumbnailProps): ReactNode {
  const containerRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  const thumbWidth = 84;
  const aspectRatio = baseSize.height / baseSize.width;
  const thumbHeight = Math.round(thumbWidth * aspectRatio);
  const thumbScale = thumbWidth / baseSize.width;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { rootMargin: '200px 0px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isVisible || !canvas) return;

    const job = drawPageOnCanvas(doc, pageNumber, canvas, thumbScale);
    job.promise.catch(() => {
      // Ignored for thumbnails
    });

    return () => job.cancel();
  }, [doc, pageNumber, thumbScale, isVisible]);

  return (
    <button
      ref={containerRef}
      type="button"
      className={`tn ${isActive ? 'on' : ''}`}
      onClick={onClick}
      aria-label={`Jump to page ${pageNumber}`}
    >
      <div
        className="pg-thumb"
        style={{ width: `${thumbWidth}px`, height: `${thumbHeight}px` }}
      >
        {isVisible ? (
          <canvas ref={canvasRef} />
        ) : (
          <span className="pg-placeholder">{pageNumber}</span>
        )}
      </div>
      <span>{pageNumber}</span>
    </button>
  );
}
