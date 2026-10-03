import React, { useEffect, useState } from 'react';
import { Users, Search, Sparkles, Check, Pause, Play } from 'lucide-react';

export function PublicBrand({ subtitle = 'ECOD · TALENT INTELLIGENCE' }) {
  return (
    <span className="careers-brand">
      <img src="/anthroprime-logo.jpg" alt="AnthroPrime logo" width="56" height="44" />
      <span>
        AnthroPrime<small>{subtitle}</small>
      </span>
    </span>
  );
}

// Decorative artwork, deliberately separate from candidate records and match scores.
export function TalentScene({ compact = false }) {
  return (
    <div className={`talent-scene ${compact ? 'compact' : ''}`} aria-hidden="true">
      <svg className="talent-paths" viewBox="0 0 360 260" fill="none">
        <circle cx="180" cy="130" r="99" stroke="currentColor" strokeDasharray="3 9" />
        <circle cx="180" cy="130" r="68" stroke="currentColor" />
        <path
          d="M72 72 Q180 20 282 83 M72 72 Q120 222 260 193 M282 83 Q330 150 260 193"
          stroke="currentColor"
          strokeDasharray="5 7"
        />
        <circle className="scene-star" cx="310" cy="42" r="4" fill="currentColor" />
        <circle className="scene-star second" cx="38" cy="180" r="5" fill="currentColor" />
      </svg>
      <div className="scene-hub">
        <Users size={31} strokeWidth={1.5} />
      </div>
      <div className="scene-person person-one">
        <span className="scene-avatar">
          <span />
        </span>
        <i />
        <i />
      </div>
      <div className="scene-person person-two">
        <span className="scene-avatar">
          <span />
        </span>
        <i />
        <i />
      </div>
      <div className="scene-person person-three">
        <span className="scene-avatar">
          <span />
        </span>
        <i />
        <i />
      </div>
      <span className="scene-bubble bubble-search">
        <Search size={19} />
      </span>
      <span className="scene-bubble bubble-check">
        <Check size={19} />
      </span>
      <span className="scene-bubble bubble-spark">
        <Sparkles size={20} />
      </span>
    </div>
  );
}

export function MotionToggle() {
  const [paused, setPaused] = useState(() => {
    try {
      const saved = localStorage.getItem('anthroprime-motion');
      return saved
        ? saved === 'paused'
        : !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return true;
    }
  });
  useEffect(() => {
    document.documentElement.dataset.motion = paused ? 'paused' : 'on';
    try {
      localStorage.setItem('anthroprime-motion', paused ? 'paused' : 'on');
    } catch {
      /* Optional preference. */
    }
  }, [paused]);
  useEffect(() => {
    const sync = (event) => {
      if (event.key === 'anthroprime-motion') setPaused(event.newValue === 'paused');
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const Icon = paused ? Play : Pause;
  return (
    <button
      type="button"
      className="motion-toggle"
      aria-label={paused ? 'Enable decorative motion' : 'Pause decorative motion'}
      title={paused ? 'Enable decorative motion' : 'Pause decorative motion'}
      aria-pressed={paused}
      onClick={() => setPaused(!paused)}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}
