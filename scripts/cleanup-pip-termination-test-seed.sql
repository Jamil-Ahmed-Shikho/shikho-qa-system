-- ============================================================
-- Cleanup for the PIP termination-flag TEST SCENARIO seeded 2026-09-29.
-- Removes EXACTLY what was seeded and nothing else: 4 plus-addressed test
-- users (agent, Team Lead, Manager, and a QA Manager used only for
-- attribution), 2 test PIP cycles (2019-01 / 2019-02 -- safely fake past
-- months chosen specifically so they can never collide with a real cycle),
-- their 2 test candidates, and the 1 termination flag raised on them.
--
-- Run this in the Supabase SQL Editor. It is scoped by email address and
-- by the two specific test months, so it is safe even if other real PIP
-- data exists (it never touches a row it didn't create).
--
-- ONE MANUAL STEP THIS SCRIPT CANNOT DO: the test Manager
-- (jamil.ahmed+pip.test.manager@shikho.com) has a real Supabase Auth
-- login. Delete it via Dashboard -> Authentication -> Users -> search
-- that email -> Delete user. (Raw SQL against auth.users is avoided here
-- since the Dashboard also cleans up related auth.sessions/identities
-- rows for you.)
-- ============================================================

-- 1. The termination flag (references the 2nd test candidate)
delete from pip_termination_flags
 where pip_candidate_id in (
   select pc.id from pip_candidates pc
   join pip_cycles c on c.id = pc.pip_cycle_id
  where c.month in ('2019-01-01', '2019-02-01')
    and pc.agent_id in (select id from users where email = 'jamil.ahmed+pip.test.agent@shikho.com')
 );

-- 2. The two test candidates
delete from pip_candidates
 where pip_cycle_id in (select id from pip_cycles where month in ('2019-01-01', '2019-02-01'))
   and agent_id in (select id from users where email = 'jamil.ahmed+pip.test.agent@shikho.com');

-- 3. The two test cycles
delete from pip_cycles where month in ('2019-01-01', '2019-02-01');

-- 4. The four test users -- in dependency order (agent -> Team Lead -> Manager; QA has no dependents)
delete from users where email = 'jamil.ahmed+pip.test.agent@shikho.com';
delete from users where email = 'jamil.ahmed+pip.test.tl@shikho.com';
delete from users where email = 'jamil.ahmed+pip.test.manager@shikho.com';
delete from users where email = 'jamil.ahmed+pip.test.qa@shikho.com';

-- Verify everything is gone:
select count(*) as remaining_test_rows from (
  select id from users where email like 'jamil.ahmed+pip.test.%@shikho.com'
  union all
  select id from pip_cycles where month in ('2019-01-01', '2019-02-01')
) x;
-- Expect 0. Then go delete the Manager's Auth login via the Dashboard (step above).
