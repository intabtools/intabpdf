import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { TOOLS, isToolImplemented } from '../tools/registry';
import { useToast } from '../hooks/useToast';
import ToolIcon from './ToolIcon';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PaletteItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  action: () => void;
}

export default function CommandPalette({ isOpen, onClose }: CommandPaletteProps): ReactNode {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { showToast } = useToast();

  // Reset search state on open during render
  if (isOpen && !prevIsOpen) {
    setPrevIsOpen(true);
    setQuery('');
    setSelectedIndex(0);
  } else if (!isOpen && prevIsOpen) {
    setPrevIsOpen(false);
  }

  // Create items list including static navigation and all registered tools
  const staticItems: PaletteItem[] = [
    {
      id: 'viewer',
      name: 'PDF Viewer',
      description: 'Open and read PDF documents',
      icon: 'eye',
      action: () => {
        navigate('/viewer');
        onClose();
      },
    },
    {
      id: 'home',
      name: 'All Tools',
      description: 'Browse the full tools catalog',
      icon: 'grid',
      action: () => {
        navigate('/');
        onClose();
      },
    },
    {
      id: 'about',
      name: 'About InTab PDF',
      description: 'Privacy rules, license, and platform info',
      icon: 'info',
      action: () => {
        navigate('/about');
        onClose();
      },
    },
  ];

  const toolItems: PaletteItem[] = TOOLS.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description + (t.availability === 'coming-soon' ? ' (Coming soon)' : ''),
    icon: t.icon,
    action: () => {
      onClose();
      navigate(`/tool/${t.id}`);
      if (!isToolImplemented(t.id)) {
        showToast('Coming soon: tool is under development');
      }
    },
  }));

  const allItems = [...staticItems, ...toolItems];

  const filteredItems = allItems.filter((item) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q)
    );
  }).slice(0, 10);

  const activeIndex = selectedIndex < filteredItems.length ? selectedIndex : 0;

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (filteredItems.length ? (prev + 1) % filteredItems.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          filteredItems.length ? (prev - 1 + filteredItems.length) % filteredItems.length : 0,
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = filteredItems[activeIndex];
        if (selected) {
          selected.action();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredItems, activeIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="mo"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dlg" role="dialog" aria-modal="true" aria-label="Search tools">
        <div className="pin">
          <Search size={16} />
          <input
            ref={inputRef}
            id="pq"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools"
            autoComplete="off"
            spellCheck="false"
            aria-label="Search tools"
          />
          <kbd>Esc</kbd>
        </div>
        <div id="pl">
          {filteredItems.length > 0 ? (
            filteredItems.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                className={`pi ${idx === activeIndex ? 'on' : ''}`}
                onClick={item.action}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <ToolIcon name={item.icon} size={18} />
                <span>{item.name}</span>
                <small>{item.description}</small>
              </button>
            ))
          ) : (
            <div className="pn">No tool matches that. Try “merge” or “compress”.</div>
          )}
        </div>
      </div>
    </div>
  );
}
