import { actionsFor, buildActions } from './automation.js';

// Plan from a workspace snapshot; persistence and UI notifications belong to the caller.
export function planAutomation(data, table, rows, before, { base, actor = 'Automation' }) {
  const rules = (data.workflowRules || []).filter((rule) => rule?.enabled);
  const candidates = new Map((data.candidates || []).map((row) => [row.id, row]));
  const demands = new Map((data.demands || []).map((row) => [row.id, row]));
  const updates = new Map();
  const names = new Set();
  const tasks = [],
    notes = [];
  const updateFor = (id) => {
    if (!updates.has(id) && candidates.has(id)) {
      const candidate = candidates.get(id);
      updates.set(id, { ...candidate, tags: [...(candidate.tags || [])], updated: base });
    }
    return updates.get(id);
  };
  rows.forEach((row, index) => {
    const matched = actionsFor(rules, table, before[index], row);
    if (!matched.length) return;
    matched.forEach((rule) => names.add(rule.name));
    const built = buildActions(matched, {
      candidate: table === 'candidates' ? row : candidates.get(row.candidateId) || null,
      demand: table === 'demands' ? row : demands.get(row.demandId) || null,
      actor,
      base,
    });
    tasks.push(...built.tasks);
    notes.push(...built.notes);
    for (const { candidateId, tag } of built.tagUpdates) {
      const update = updateFor(candidateId);
      if (update && !update.tags.includes(tag)) update.tags.push(tag);
    }
    for (const { candidateId, text } of built.nextActions) {
      const update = updateFor(candidateId);
      if (update) update.nextAction = text;
    }
  });
  return {
    names: [...names],
    batches: [
      ['tasks', tasks],
      ['notes', notes],
      ['candidates', [...updates.values()]],
    ].filter(([, records]) => records.length),
  };
}
