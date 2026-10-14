-- ============================================================
-- CX Inbound & Engagement rubric — version 2 (Jamil, 2026-10-14)
--
-- Replaces the 16-parameter v1 scorecard with a 14-parameter v2, per the
-- "Parameters.xlsx" sheet he shared and confirmed final. Follows the exact
-- sequence the app's own `createRubricVersion()` server action uses
-- (src/lib/rubrics/actions.ts) — clone as version+1, point the team mapping
-- at the new rubric, deactivate the old one — but with the NEW content
-- instead of a straight clone, since the parameters themselves changed
-- (two merges, one brand-new parameter, several reworded/added errors).
--
-- v1 (b14d7b76-a5f3-4108-8a48-1130a4c29c5e) is NOT edited in place and NOT
-- deleted — §4's immutability rule: 38 submitted + 4 draft audits already
-- point at it, and 9 of those submitted audits have real ticks against its
-- (mis-seeded) "Communication Clarity and Organization" error list, which
-- would change in apparent meaning if that text were rewritten after the
-- fact. v1 simply stops being the active rubric for CX Inbound/Engagement;
-- the 4 open drafts keep scoring against v1 exactly as they do today
-- (an audit's rubric_id is locked at creation, never re-resolved, §4).
--
-- Net point math: Probing Questions (8) + Active Listening (4) -> merged
-- "Probing Questions/Active Listening" (10, -2) and Politeness (6) +
-- Personalization (6) + No Avoiding Tendency (6) -> merged "Professionalism,
-- Empathy and Call Courtesy" (10, -8) together free up exactly the 10 points
-- the new "CRM Profile Management Accuracy" parameter needs. Total stays
-- 100, same as every rubric (§3).
-- ============================================================

do $$
declare
  v_old_rubric_id uuid := 'b14d7b76-a5f3-4108-8a48-1130a4c29c5e';
  v_new_rubric_id uuid;
  v_jamil_id uuid;
  v_cat_id uuid;
  v_param_id uuid;
begin
  select id into v_jamil_id from users where email = 'jamil.ahmed@shikho.com';
  if v_jamil_id is null then
    raise exception 'jamil.ahmed@shikho.com not found — refusing to guess created_by.';
  end if;

  if not exists (select 1 from rubrics where id = v_old_rubric_id and name = 'CX Inbound & CX Engagement' and version = 1) then
    raise exception 'Expected v1 CX Inbound & CX Engagement rubric not found at the expected id — aborting.';
  end if;

  insert into rubrics (name, total_points, version, is_active, created_by)
  values ('CX Inbound & CX Engagement', 100, 2, true, v_jamil_id)
  returning id into v_new_rubric_id;

  insert into rubric_categories (rubric_id, name, sort_order)
  values (v_new_rubric_id, 'All Parameters', 0)
  returning id into v_cat_id;

  -- 1. Greeting and Opening (3 pts)
  insert into rubric_parameters (category_id, name, points, sort_order) values
    (v_cat_id, 'Greeting and Opening', 3, 0) returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to greet according to the script/protocol', 0),
    (v_param_id, 'Greeted late (exceeding a 3-second buffer)', 1),
    (v_param_id, 'Lacked enthusiasm or liveliness in the interaction', 2);

  -- 2. Hold/Transfer Procedure (2 pts)
  insert into rubric_parameters (category_id, name, points, sort_order) values
    (v_cat_id, 'Hold/Transfer Procedure', 2, 1) returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to adhere to the hold procedure (exceeding 60 seconds)', 0),
    (v_param_id, 'Did not follow the script for communication before and after returning from hold', 1);

  -- 3. Probing Questions/Active Listening (10 pts) — merges old "Active Listening" + "Probing Questions"
  insert into rubric_parameters (category_id, name, points, sort_order) values
    (v_cat_id, 'Probing Questions/Active Listening', 10, 2) returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Did not inquire about any prior communication with an academic counselor', 0),
    (v_param_id, 'Failed to ask specific questions to accurately identify the problem', 1),
    (v_param_id, 'Did not identify why the customer was not interested in enrolling in the course', 2),
    (v_param_id, 'Failed to acknowledge responses or remained inactive while listening', 3),
    (v_param_id, 'Lack of connectivity', 4);

  -- 4. Issue Identification and Resolution (4 pts)
  insert into rubric_parameters (category_id, name, points, sort_order) values
    (v_cat_id, 'Issue Identification and Resolution', 4, 3) returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Did not perform all troubleshooting steps or clear cache or cookies', 0),
    (v_param_id, 'Failed to identify the customer''s objective in a timely manner', 1);

  -- 5. Product Features and Pricing Explanation (15 pts)
  insert into rubric_parameters (category_id, name, points, sort_order) values
    (v_cat_id, 'Product Features and Pricing Explanation', 15, 4) returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to provide complete course details (number of classes, exams, class routine, duration)', 0),
    (v_param_id, 'Failed to share the main features and unique selling points (USP) of the relevant courses', 1),
    (v_param_id, 'Did not demonstrate the effectiveness of Shikho''s specialized teachers compared to local teachers', 2),
    (v_param_id, 'Failed to show a demonstrative calculation of the course price', 3),
    (v_param_id, 'Did not compare the course price with local or offline alternatives', 4);

  -- 6. Sales Conversion/Conversation Summarization/Lead Escalation (15 pts)
  insert into rubric_parameters (category_id, name, points, sort_order) values
    (v_cat_id, 'Sales Conversion/Conversation Summarization/Lead Escalation', 15, 5) returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to confirm whether the customer showed interest in purchasing the product', 0),
    (v_param_id, 'Did not seek an appointment or properly follow up on rescheduling', 1),
    (v_param_id, 'Failed to accurately escalate the lead in the sheet with complete information', 2);

  -- 7. Communication Clarity and Organization (4 pts) — corrected error list (v1's was a
  -- mis-seeded copy of parameter 6's errors; this is the real one, per Jamil's file)
  insert into rubric_parameters (category_id, name, points, sort_order) values
    (v_cat_id, 'Communication Clarity and Organization', 4, 6) returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Repeated customer concerns, queries, or responses unnecessarily', 0),
    (v_param_id, 'Used incorrect pronunciation, local accents, or jargon', 1);

  -- 8. No Hurry/No Interruption (4 pts)
  insert into rubric_parameters (category_id, name, points, sort_order) values
    (v_cat_id, 'No Hurry/No Interruption', 4, 7) returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Spoke at an unclear or excessively fast or slow pace', 0),
    (v_param_id, 'Failed to avoid interruptions', 1);

  -- 9. Use of Magic Words and Spontaneity (4 pts)
  insert into rubric_parameters (category_id, name, points, sort_order) values
    (v_cat_id, 'Use of Magic Words and Spontaneity', 4, 8) returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Demonstrated a lack of enthusiasm, liveliness, or energy during the call', 0),
    (v_param_id, 'Did not use positive or polite phrases (please, sorry, kindly) and used negative words instead', 1);

  -- 10. Professionalism, Empathy and Call Courtesy (10 pts) — merges old "Politeness and
  -- Rudeness Avoidance" + "Personalization and Attitude" + "No Avoiding Tendency"
  insert into rubric_parameters (category_id, name, points, sort_order) values
    (v_cat_id, 'Professionalism, Empathy and Call Courtesy', 10, 9) returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Used dictating, directive, or commanding language, lacking cordiality', 0),
    (v_param_id, 'Failed to express empathy when the customer mentioned a personal issues', 1),
    (v_param_id, 'Engaged in unprofessional activities (coughing, sneezing, yawning, laughing, side talking)', 2),
    (v_param_id, 'Failed to show a positive mindset or willingness to assist the customer', 3),
    (v_param_id, 'Redirected the customer to another channel unnecessarily', 4),
    (v_param_id, 'Intentionally avoided customer concerns or complaints', 5);

  -- 11. CRM Profile Management Accuracy (10 pts) — brand new parameter
  insert into rubric_parameters (category_id, name, points, sort_order) values
    (v_cat_id, 'CRM Profile Management Accuracy', 10, 10) returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to update CRM data accurately', 0),
    (v_param_id, 'Failed to update class information accurately', 1),
    (v_param_id, 'Failed to correct or update the student''s name', 2),
    (v_param_id, 'Failed to add an alternative mobile number where applicable', 3);

  -- 12. Accurate Escalation/Callback (8 pts)
  insert into rubric_parameters (category_id, name, points, sort_order) values
    (v_cat_id, 'Accurate Escalation/Callback', 8, 11) returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to escalate the issue accurately and completely through the correct channels', 0),
    (v_param_id, 'Did not call back the customer after a dropped call', 1);

  -- 13. Call Closing and Further Assistance (3 pts)
  insert into rubric_parameters (category_id, name, points, sort_order) values
    (v_cat_id, 'Call Closing and Further Assistance', 3, 12) returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Did not ask the customer "আমি কি তোমাকে বা আপনাকে বিষয়টি বোঝাতে পেরেছি"', 0),
    (v_param_id, 'Failed to ensure the call ended with the proper closing script', 1);

  -- 14. Wrap-Up Code Selection/ Lead Stage Update Accuracy (8 pts) — gains a second error
  insert into rubric_parameters (category_id, name, points, sort_order) values
    (v_cat_id, 'Wrap-Up Code Selection/ Lead Stage Update Accuracy', 8, 13) returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Did not tag the correct call wrap-up code or disposition on time', 0),
    (v_param_id, 'Failed to update lead stage correctly', 1);

  -- Fatals — kept exactly as on v1, per Jamil's explicit "keep fatal untouched".
  insert into fatal_parameters (rubric_id, description, severity, sort_order)
  select v_new_rubric_id, description, severity, sort_order
  from fatal_parameters
  where rubric_id = v_old_rubric_id;

  -- Point CX Inbound and Engagement at the new version. The old mapping rows
  -- (-> v1) are left in place, same as createRubricVersion() does — they
  -- don't drive anything going forward (the app picks the active + newest
  -- mapped rubric per team, src/lib/audits/rubric-mapping.ts) but a historical
  -- join through team_rubric_mapping for v1 still resolves correctly.
  insert into team_rubric_mapping (team_name, rubric_id) values
    ('CX Inbound', v_new_rubric_id),
    ('Engagement', v_new_rubric_id);

  update rubrics set is_active = false where id = v_old_rubric_id;

  raise notice 'Created CX Inbound & CX Engagement v2 as %, deactivated v1 %', v_new_rubric_id, v_old_rubric_id;
end $$;
