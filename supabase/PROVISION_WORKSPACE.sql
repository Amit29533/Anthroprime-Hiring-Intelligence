-- Run AFTER 001_ecod.sql. First create/invite users through Supabase Auth.
-- Replace the email below with your actual team's existing Auth email.
-- Execute with the SQL Editor administrator role, never in browser code.
do $$
declare workspace uuid; member uuid;
begin
 select id into member from auth.users where email='amit29533@gmail.com';
 if member is null then raise exception 'Create the Auth user and replace the email first'; end if;
 insert into public.workspaces(name) values ('AnthroPrime') returning id into workspace;
 insert into public.memberships(user_id,workspace_id,role) values(member,workspace,'admin');
end $$;

-- To add another existing Auth user to the same workspace:
-- insert into public.memberships(user_id,workspace_id,role)
-- select u.id, m.workspace_id, 'recruiter'
-- from auth.users u cross join public.memberships m
-- where u.email='COLLEAGUE_EMAIL' and m.user_id='ADMIN_AUTH_UUID';
