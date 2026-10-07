import { id, stage1Database } from './stage1-harness.js';
export const config = {
  requirements: [
    { id: 'years', kind: 'experience', name: 'Relevant experience', minimum: 3, recencyDays: 120 },
    { id: 'eligibility', kind: 'eligibility', name: 'Work authorization' },
  ],
  kit: [
    { id: 'technical', label: 'Technical exercise', weight: 70 },
    { id: 'communication', label: 'Communication exercise', weight: 30 },
  ],
  threshold: 80,
  assessmentDays: 90,
  reviewers: 1,
  requireReadyForSubmission: true,
};
export async function journeyFixture(t) {
  const h = await stage1Database(t);
  const { db, act, rpc, today } = h;
  await db.exec(
    `insert into demands(id,workspace_id,title,client,skills,"minExperience","maxNotice",budget,location,mode,positions,priority,target,weights)values('${id(51)}','${id(11)}','Engineer','Client',array['SQL'],1,30,20,'Pune','Remote',1,'High',current_date,'{"skills":40,"experience":20,"readiness":10,"availability":10,"budget":10,"location":10}');insert into memberships values('${id(5)}','${id(11)}','assessor');`,
  );
  await act(1);
  const expiry = new Date(Date.now() + 86400000 * 30).toISOString();
  const assignment = (
    await rpc('api_assignments_admin', [
      'grant',
      id(61),
      { member: id(5), kind: 'evaluation', target: id(21), expires: expiry },
      0,
    ])
  ).assignment;
  const context = (candidate = id(21)) => rpc('api_demand_journey', ['context', id(51), candidate]);
  const action = async (kind, n, payload, candidate = id(21)) =>
    rpc('api_demand_journey', [
      kind,
      id(51),
      candidate,
      id(n),
      (await context(candidate)).head,
      payload,
      0,
    ]);
  await action('configure', 100, config, null);
  const until = (
    await db.query("select ((statement_timestamp()at time zone'UTC')::date+30)::text d")
  ).rows[0].d;
  await act(2);
  await action('claim', 101, {
    kind: 'experience',
    name: 'Relevant experience',
    value: 5,
    source: 'Employment evidence reviewed',
    observed: today,
    validUntil: until,
    confirmed: true,
  });
  await action('claim', 102, {
    kind: 'eligibility',
    name: 'Work authorization',
    value: true,
    source: 'Eligibility document reviewed',
    observed: today,
    validUntil: until,
    confirmed: true,
  });
  const start = (n) =>
    action('start', n, { members: [{ member: id(5), assignment: assignment.id }] });
  const evaluate = async (cycle, n, score) => {
    await act(5);
    const c = await rpc('api_assigned_demand_journey', [cycle]);
    const payload = {
      scores: { technical: score, communication: score },
      evidence: {
        technical: 'Reviewed exercise answer',
        communication: 'Reviewed communication exercise',
      },
    };
    return rpc('api_assigned_demand_journey', [cycle, id(n), c.head, payload]);
  };
  return { ...h, context, action, start, evaluate, assignment, until };
}
