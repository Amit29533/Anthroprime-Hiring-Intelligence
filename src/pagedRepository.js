import { getSupabase } from './repository.js';

export async function repositoryRead(name, args = {}) {
  const client = await getSupabase();
  if (!client) throw new Error('Paged repository reads require a cloud workspace.');
  const { data, error } = await client.rpc(name, args);
  if (error)
    throw new Error(
      name === 'api_repository_views' && error.code === '23505'
        ? 'A personal view with this name already exists. Choose another name.'
        : ['42883', 'PGRST202'].includes(error.code)
          ? name === 'api_delivery_sandbox'
            ? 'Apply all migrations through 20261008050701_dependent_stage1_delivery.sql to enable the dependent delivery sandbox.'
            : name === 'api_foundation'
              ? 'Apply all migrations through 20261008035834_foundation_milestone.sql to enable Foundation tools.'
              : ['api_operations', 'api_sla_worklist'].includes(name)
                ? 'Apply all migrations through 20261007190524_stage5_operations_governance.sql to enable operations and SLA review.'
                : /^api_(recruiter_worklist|worklist_)/.test(name)
                  ? 'Apply all migrations through 20261007114511_recruiter_worklist.sql to enable the recruiter worklist.'
                  : ['api_feedback_staff', 'api_feedback_portal', 'api_feedback_queue'].includes(
                        name,
                      )
                    ? 'Apply all Stage 4 feedback migrations before using this workflow.'
                    : name === 'api_test_communications'
                      ? 'Apply all Stage 3 communication migrations before using this workflow.'
                      : [
                            'api_demand_journey',
                            'api_assigned_demand_journey',
                            'api_demand_readiness_report',
                            'api_export_demand_readiness_report',
                          ].includes(name)
                        ? 'Apply all Stage 2 demand journey migrations before using this workflow.'
                        : [
                              'api_candidate_facts',
                              'api_record_candidate_fact',
                              'api_duplicate_queue',
                              'api_duplicate_context',
                              'api_duplicate_decision',
                              'api_assignments_admin',
                              'api_assigned_work',
                              'api_assigned_assessment',
                            ].includes(name)
                          ? 'Apply all Stage 1 migrations to enable sourced facts, duplicate review and scoped assignments.'
                          : [
                                'api_candidate_availability',
                                'api_record_candidate_availability',
                              ].includes(name)
                            ? 'Apply the sourced_candidate_availability migration to enable availability history.'
                            : [
                                  'api_candidate_profile_context',
                                  'api_candidate_profile_edit',
                                ].includes(name)
                              ? 'Apply the candidate_profile_edit migration to enable profile editing.'
                              : ['api_repository_quality', 'api_anthro_id_capacity'].includes(name)
                                ? 'Apply all migrations through 20261007120440_repository_quality_and_identity_capacity.sql to enable repository quality and identity capacity.'
                                : [
                                      'api_candidate_scorecards',
                                      'api_record_candidate_scorecard',
                                    ].includes(name)
                                  ? 'Apply the candidate_scorecards migration to enable scorecards.'
                                  : [
                                        'api_candidate_readiness',
                                        'api_decide_candidate_readiness',
                                      ].includes(name)
                                    ? 'Apply the candidate_readiness_journal migration to enable readiness review.'
                                    : [
                                          'api_candidate_contacts',
                                          'api_change_candidate_contact',
                                        ].includes(name)
                                      ? 'Apply the candidate_contacts_verification migration to enable contact review.'
                                      : [
                                            'api_repository_views',
                                            'api_candidate_quick_context',
                                            'api_candidate_quick_edit',
                                          ].includes(name)
                                        ? 'Apply the repository_views_and_quick_edit migration to enable this action.'
                                        : 'Apply the paged_repository migration to enable this workspace view.'
          : error.message,
    );
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Repository returned an invalid response.');
  if (name === 'api_repository_page' && (!Array.isArray(data.rows) || data.rows.length > 50))
    throw new Error('Repository returned an invalid page.');
  if (
    name === 'api_candidate_section' &&
    args.p_section !== 'profile' &&
    (!Array.isArray(data.rows) || data.rows.length > 50)
  )
    throw new Error('Candidate section returned an invalid page.');
  return data;
}
