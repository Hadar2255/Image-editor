import { useState, type ReactNode } from 'react';

const STORAGE_KEY = 'raw-studio:sections';

function loadOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/** Collapsible panel section; open/closed state is remembered per title. */
export function Section({
  title,
  children,
  defaultOpen = true,
  actions,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(() => loadOpen()[title] ?? defaultOpen);
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadOpen(), [title]: !open }));
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <header className="section-head">
        <button className="section-toggle" onClick={toggle} aria-expanded={open}>
          <span className="chevron" aria-hidden>
            ▸
          </span>
          {title}
        </button>
        {open && actions}
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}
