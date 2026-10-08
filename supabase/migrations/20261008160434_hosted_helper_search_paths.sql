-- Hosted advisor follow-up: retain helper behavior and privileges while pinning lookup.
begin;
alter function public.demand_requisition_terms(public.demands) set search_path = '';
alter function public.skill_evidence_weight(text) set search_path = '';
commit;
