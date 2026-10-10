import React from 'react';
import {
  Atom,
  Braces,
  Code2,
  Database,
  Cloud,
  Container,
  GitBranch,
  Globe,
  Coffee,
  Hexagon,
  Palette,
  BarChart3,
} from 'lucide-react';

// Familiar technology cues, with a readable label for every skill and a neutral fallback.
const technologies = [
  [/^react(?:\.js|js| native)?$/, Atom, 'cyan'],
  [/^node(?:\.js|js)?$/, Hexagon, 'green'],
  [/^(javascript|js|typescript|ts)$/, Braces, 'blue'],
  [/^python$/, Code2, 'amber'],
  [/^java$/, Coffee, 'orange'],
  [/^(sql|postgres(?:ql)?|mysql|mongodb|redis|oracle|sqlite)$/, Database, 'teal'],
  [/^(aws|azure|gcp|google cloud|cloud computing)$/, Cloud, 'blue'],
  [/^(docker|kubernetes|k8s)$/, Container, 'cyan'],
  [/^(git|github|gitlab)$/, GitBranch, 'orange'],
  [/^(html(?:5)?|css(?:3)?|angular|vue(?:\.js|js)?|next(?:\.js|js)?|frontend)$/, Globe, 'violet'],
  [/^(figma|design|ui\/ux|ui design|ux design)$/, Palette, 'rose'],
  [/^(excel|power bi|tableau|data analysis)$/, BarChart3, 'green'],
];

export function SkillBadge({ skill, className = '', title }) {
  const match = technologies.find(([pattern]) => pattern.test(String(skill).trim().toLowerCase()));
  const Icon = match?.[1] || Code2;
  const tone = match?.[2] || 'violet';
  return (
    <span className={`skill-badge skill-${tone} ${className}`} title={title}>
      <Icon size={14} aria-hidden="true" />
      {skill}
    </span>
  );
}
