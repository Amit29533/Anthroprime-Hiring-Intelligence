import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Bell, CheckCircle2 } from 'lucide-react';
import { IconButton, Badge } from './ui.jsx';
import { searchWorkspace, groupResults } from './search.js';
import {
  myQueue,
  notifications,
  notificationCount,
  identityFor,
  ownerLooksUnmatched,
} from './worklist.js';

/**
 * Cross-workspace search box. Results are ranked across every entity, so a recruiter can find a
 * demand or a client without first navigating to the right page.
 */
export function GlobalSearch({ data, isAdmin, onOpen, query, setQuery }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef(null);
  const results = useMemo(() => searchWorkspace(data, query, { isAdmin }), [data, query, isAdmin]);
  const groups = useMemo(() => groupResults(results), [results]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  // Clicking anywhere else dismisses the panel, as a dropdown should.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  function choose(result) {
    setOpen(false);
    setQuery('');
    onOpen(result);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="global-search-wrap" ref={box}>
      <form
        className="global-search"
        onSubmit={(e) => {
          e.preventDefault();
          if (results[active]) choose(results[active]);
        }}
      >
        <Search size={16} />
        <input
          aria-label="Search your workspace"
          placeholder="Search candidates, demands, clients…"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        <kbd>↵</kbd>
      </form>
      {open && query.trim().length >= 2 && (
        <div className="search-results" role="listbox" aria-label="Search results">
          {results.length === 0 ? (
            <p className="search-empty">No matches for “{query.trim()}”.</p>
          ) : (
            groups.map((group) => (
              <div key={group.type}>
                <h4>{group.label}</h4>
                {group.items.map((item) => {
                  const index = results.indexOf(item);
                  return (
                    <button
                      key={`${item.type}-${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      className={`search-result ${index === active ? 'active' : ''}`}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(item)}
                    >
                      <span>
                        <strong>{item.title}</strong>
                        {item.subtitle && <small>{item.subtitle}</small>}
                      </span>
                      {item.meta && <em>{item.meta}</em>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** The bell, reporting only work that is actionable today. */
export function NotificationBell({ data, user, isAdmin, navigate, now = Date.now }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const identity = useMemo(() => identityFor(user), [user]);
  const queue = useMemo(
    () => myQueue(data, identity, { now: now(), isAdmin }),
    [data, identity, isAdmin, now],
  );
  const items = notifications(queue);
  const count = notificationCount(queue);
  const unmatched = ownerLooksUnmatched(data, identity);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  return (
    <div className="bell-wrap" ref={box}>
      <IconButton
        icon={Bell}
        label={count ? `${count} items need attention` : 'Nothing needs attention'}
        onClick={() => setOpen(!open)}
      />
      {count > 0 && <span className="bell-badge">{count > 99 ? '99+' : count}</span>}
      {open && (
        <div className="bell-panel">
          <h4>Needs attention</h4>
          {items.length === 0 ? (
            <p className="search-empty">
              <CheckCircle2 size={14} /> Nothing due today.
              {unmatched && (
                <> Records here are owned by other names, so nothing is matched to you.</>
              )}
            </p>
          ) : (
            items.map((item) => (
              <button
                key={item.key}
                type="button"
                className="bell-item"
                onClick={() => {
                  setOpen(false);
                  navigate(item.page);
                }}
              >
                <Badge tone={item.tone}>{item.count}</Badge>
                <span>{item.label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
