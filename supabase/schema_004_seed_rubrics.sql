-- ============================================================
-- SHIKHO QA AUDIT MANAGEMENT SYSTEM
-- Schema 004 — Seed the 3 confirmed rubrics (§3)
-- Source: Shikho_QA_Rubric_Seed_Content.md (Jamil's verified content)
-- Test this whole file in the Supabase SQL Editor before relying on it.
-- Requires schema_003_rubrics.sql to already be applied.
--
-- created_by is left NULL — seeding runs as the SQL Editor's own role,
-- not as a row in `users`, so there's no valid FK target for it here.
--
-- CX Non-Voice and CX Inbound & Engagement have no category grouping
-- in the source content (only Telesales does) — since rubric_parameters
-- requires a category_id, each of those two rubrics gets a single
-- umbrella category ("All Parameters") to hold its flat parameter list.
-- This is a structural accommodation only; it adds no scoring content.
--
-- Uses `insert ... returning id into v_var` inside DO blocks per the
-- CLAUDE.md §14 lesson (bare RETURNING doesn't work in PL/pgSQL).
-- ============================================================

-- ================================================================
-- 1. Telesales Scorecard — Telesales, Retention, TS3P, BPO — 100 pts
-- ================================================================
do $$
declare
  v_rubric_id uuid;
  v_cat_id uuid;
  v_param_id uuid;
begin
  insert into rubrics (name, version, total_points, is_active)
  values ('Telesales Scorecard', 1, 100, true)
  returning id into v_rubric_id;

  insert into team_rubric_mapping (team_name, rubric_id) values
    ('Telesales', v_rubric_id),
    ('Retention', v_rubric_id),
    ('TS3P', v_rubric_id),
    ('BPO', v_rubric_id);

  -- Category: Call opening and Rapport Building
  insert into rubric_categories (rubric_id, name, sort_order)
  values (v_rubric_id, 'Call opening and Rapport Building', 0)
  returning id into v_cat_id;

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Call Opening', 2, 0)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to greet according to script, protocol', 0),
    (v_param_id, 'Late Greetings (03 Sec buffer time)', 1),
    (v_param_id, 'Failed to address with student''s name and AC name', 2),
    (v_param_id, 'Failed to mention Designation and the brand name', 3);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Rapport Building', 7, 1)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to disclose the purpose of the Call', 0),
    (v_param_id, 'Ask proper probing questions to identify Strong Subjects / Weak Subjects, Reason for weakness, and Ambition', 1),
    (v_param_id, 'Failed to do student research (Number of Tuition, Parents Profession, Decision Maker)', 2),
    (v_param_id, 'Failed to build connectivity with students/guardian', 3);

  -- Category: Lead Relevance
  insert into rubric_categories (rubric_id, name, sort_order)
  values (v_rubric_id, 'Lead Relevance', 1)
  returning id into v_cat_id;

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Pitch Personalization Based on Lead Behavior', 8, 0)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to refer to the student''s/guardian''s recent activity (e.g., app video watched, trial class joined) during the pitch.', 0),
    (v_param_id, 'Failed to connect recent activity to their interests, subject preferences, or motivation to study with us', 1);

  -- Category: Product and Benefits
  insert into rubric_categories (rubric_id, name, sort_order)
  values (v_rubric_id, 'Product and Benefits', 2)
  returning id into v_cat_id;

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Features & Benefits', 12, 0)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to clearly highlight the main features of the course (Live & Recorded Classes, Animated Videos, Report Card, Practice & Live MCQs, Class & Smart Notes)', 0),
    (v_param_id, 'Failed to share the complete course information with TnC (Number of classes/Exams/Weekly Class Routine/Class and Course Duration/Subjects/Teachers)', 1),
    (v_param_id, 'Failed to share specialized teacher details (names, subject relevance, profile/background, and comparison with local teachers)', 2),
    (v_param_id, 'Failed to relate features to the student''s life and explain how it can improve results, learning, and subject expertise.', 3);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Price Demonstration', 8, 1)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to show demonstrative calculation of price effect (Offering right products according to financial capabilities)', 0),
    (v_param_id, 'Failed to show Price comparison with offline/Local Teachers', 1);

  -- Category: Negotiation and Rebuttals
  insert into rubric_categories (rubric_id, name, sort_order)
  values (v_rubric_id, 'Negotiation and Rebuttals', 3)
  returning id into v_cat_id;

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Handling Objection & Overcome the barriers', 10, 0)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to solve or advice the solution where applicable', 0),
    (v_param_id, 'Failed to reassure that the compliant/barriers has been overcomed', 1);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Generate Interest and Create Urgency', 8, 1)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to promote free trial/App experience or send relevant materials via WhatsApp to spark interest', 0),
    (v_param_id, 'Failed to highlight Shikho AI, Doubt Solving, Archive Courses or other add-ons in an effective manner', 1),
    (v_param_id, 'Failed to use offers (Discounts, Early Bird, Gifts) to create urgency or make the student feel exclusive', 2);

  -- Category: Call Comprehension & Sales Closing
  insert into rubric_categories (rubric_id, name, sort_order)
  values (v_rubric_id, 'Call Comprehension & Sales Closing', 4)
  returning id into v_cat_id;

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Call Comprehension', 5, 0)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to ensure Student/Guardian engagement in the call', 0);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Sales Closing (Conv. Summarization & Ask for sale)', 7, 1)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to summarize the call and use effective sales tactics to close the deal', 0),
    (v_param_id, 'Failed to Seek an appointment (Failed to ask for rescheduled time/Rightly follow up)', 1);

  -- Category: Professionalism & Call Courtesy
  insert into rubric_categories (rubric_id, name, sort_order)
  values (v_rubric_id, 'Professionalism & Call Courtesy', 5)
  returning id into v_cat_id;

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Soft Skill & Demonstrating Empathy', 10, 0)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to avoid interruptions', 0),
    (v_param_id, 'Failed to avoid negative/impolite words and use magical words', 1),
    (v_param_id, 'Failed to avoid "missing of apology or empathy/excessive apology', 2),
    (v_param_id, 'Failed to ask for information in a requesting/humble tone', 3),
    (v_param_id, 'Failed to avoid using dictating/directive/authoritative expressions', 4);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Speech quality, Communication & Effective Listening', 5, 1)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to maintain Pace, Pitch, and Voice Clarity', 0),
    (v_param_id, 'Failed to avoid Local accent/mumbling', 1),
    (v_param_id, 'Failed to display good and easy sentence construction/correct pronunciation or avoid jargon', 2),
    (v_param_id, 'Failed to avoid unprofessional/causal activities (coughing/sneezing/yawning/sighing/laughing/side talking)', 3),
    (v_param_id, 'Failed to acknowledge responses/avoid being inactive while listening', 4),
    (v_param_id, 'Failed to speak confidently about Shikho''s offerings or explain convincingly why a student/guardian should choose Shikho', 5),
    (v_param_id, 'Failed to show liveliness (robotic/rehearsed/scripted/clumsy/drowsy/moody/lethargic/Awkward Pause-5 sec)', 6);

  -- Category: Utilize CRM Features Effectively
  insert into rubric_categories (rubric_id, name, sort_order)
  values (v_rubric_id, 'Utilize CRM Features Effectively', 6)
  returning id into v_cat_id;

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Lead Stage Update Accuracy', 5, 0)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to update lead stage correctly', 0),
    (v_param_id, 'Failed to update Employee lead DND status properly', 1);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'CRM Profile Management Accuracy', 3, 1)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to update class Information accurately', 0),
    (v_param_id, 'Failed to correct or update Student''s Name', 1),
    (v_param_id, 'Failed to add an alternative mobile number where applicable', 2);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'CRM Task & Follow-Up Accuracy', 5, 2)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to complete assigned tasks properly', 0),
    (v_param_id, 'Failed to create Follow-Up tasks where necessary', 1);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Documentation & Notes Quality', 3, 3)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to capture or input notes accurately', 0),
    (v_param_id, 'Failed to maintain professionalism in note-taking', 1);

  -- Category: Call Closing & Wrap-up
  insert into rubric_categories (rubric_id, name, sort_order)
  values (v_rubric_id, 'Call Closing & Wrap-up', 7)
  returning id into v_cat_id;

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Call Closing & Wrap-up', 2, 0)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to ensure a standard closing script in all eligible calls to enhance referral opportunities (well-placed clear and enthusiastic)', 0),
    (v_param_id, 'Failed to input correct CQC/Wrap-up or Disposition the call on time', 1);

  -- Fatal parameters
  insert into fatal_parameters (rubric_id, description, severity, sort_order) values
    (v_rubric_id, 'Failed to share correct/complete information with customers which has a monetary impact', 'critical', 0),
    (v_rubric_id, 'Failed to avoid eating, drinking, laughing, or making unnecessary noise/side talk during the conversation', 'major', 1),
    (v_rubric_id, 'Failed to avoid using abusive language, sarcastic, pinching, offensive, rude, loud word and voices', 'critical', 2),
    (v_rubric_id, 'Failed to avoid ignoring Intentional Customer or Lack of Engagement', 'critical', 3),
    (v_rubric_id, 'Failed to avoid flirting with the customer', 'critical', 4),
    (v_rubric_id, 'Failed to avoid any incorrect course enrollment or refund issues', 'critical', 5),
    (v_rubric_id, 'Failed to avoid False commitment', 'critical', 6),
    (v_rubric_id, 'Failed to avoid transferring leads to another academic counselor with the intention of meeting sales targets', 'critical', 7),
    (v_rubric_id, 'Failed to Maintain organized and professional language in all call notes in CRM for accuracy and coherence', 'major', 8),
    (v_rubric_id, 'Failed to avoid unprofessional examples', 'critical', 9),
    (v_rubric_id, 'Failed to maintain CRM Hygine properly', 'critical', 10),
    (v_rubric_id, 'Misclassification of leads due to the selection of incorrect stages', 'critical', 11),
    (v_rubric_id, 'Failed to ensure calls conclude within 5 seconds after closing', 'major', 12);
end $$;

-- ================================================================
-- 2. CX Non-Voice — CX Non-Voice — 100 pts
-- No category grouping in source — single umbrella category.
-- ================================================================
do $$
declare
  v_rubric_id uuid;
  v_cat_id uuid;
  v_param_id uuid;
begin
  insert into rubrics (name, version, total_points, is_active)
  values ('CX Non-Voice', 1, 100, true)
  returning id into v_rubric_id;

  insert into team_rubric_mapping (team_name, rubric_id) values
    ('CX Non-Voice', v_rubric_id);

  insert into rubric_categories (rubric_id, name, sort_order)
  values (v_rubric_id, 'All Parameters', 0)
  returning id into v_cat_id;

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Greetings and Opening of the chat', 5, 0)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to greet according to the script or protocol', 0),
    (v_param_id, 'Failed to properly address the customer according to protocol', 1),
    (v_param_id, 'Delayed Greetings (with a 90-second allowable buffer window)', 2);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Effective Communication and Sentense Construction', 10, 1)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Presence of spelling mistakes during the interaction.', 0),
    (v_param_id, 'Using dictating, directive, authoritative, or commanding language.', 1),
    (v_param_id, 'Failing to display good sentence construction and correct punctuation.', 2),
    (v_param_id, 'Syntax errors or obvious typing mistakes.', 3),
    (v_param_id, 'Wasting the customer''s time due to unclear communication.', 4);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Professionalism and Empathy', 10, 2)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Sounding Robotic or Scripted: Overusing unpersonalized templates, making the customer feel they are talking to a bot.', 0),
    (v_param_id, 'Failing to Show Empathy: Missing the chance to apologize or acknowledge the customer''s frustration when they experience a delay, error, or inconvenience.', 1),
    (v_param_id, 'Arguing or Blaming the Customer : Pushing back inappropriately, failing to calm a tense situation, or using words that make the customer feel like the problem is their fault.', 2),
    (v_param_id, 'Using an Unprofessional Tone: Being sarcastic, passive-aggressive, or overly casual (such as using slang or too many emojis) during the interaction.', 3),
    (v_param_id, 'Ignoring Provided Information (Poor Active Listening):Not reading the chat history carefully and asking the customer to repeat details they have already shared.', 4);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Probing and Concern Assessments', 8, 3)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to handle the chat expertly', 0),
    (v_param_id, 'Failing to address customer concerns', 1),
    (v_param_id, 'Failed to troubleshoot customers technical issues', 2);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Information Accuracy and Completeness', 12, 4)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'complete course information with TnC (Number of classes or Exams, Weekly Class Routine, Class and Course Duration, Subjects, Teachers)', 0);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Product (FnB) or Solution Presentation', 10, 5)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Emphasized product features rather than focusing on how those features turns into customer benefit', 0),
    (v_param_id, 'Failed to demonstrate the effectiveness of specialized teachers compared to local teachers', 1),
    (v_param_id, 'Failed to show price effect demonstrative calculation', 2),
    (v_param_id, 'Failed to show Price comparison with offline or Local Teachers', 3),
    (v_param_id, 'Failed to give alternative solution where necessary', 4);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Sales Conversion and Upselling Skills', 15, 6)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failure to Identify Sales Opportunities when the customer shows interest', 0),
    (v_param_id, 'The agent does not effectively ask for the sale, leaving the conversation open-ended', 1),
    (v_param_id, 'Failed to handle the customer''s concerns well, which caused unsure about buying', 2),
    (v_param_id, 'Failed to connect with the customer, which caused less interest in the product', 3),
    (v_param_id, 'Did not utilize available sales tools or resources effectively to enhance the sales pitch', 4);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Documentation and Follow-Up Accuracy', 10, 7)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to escalate the issue to the right concern', 0),
    (v_param_id, 'Failed to adhere the call back request of customer', 1),
    (v_param_id, 'Failed to capture all information correctly and completely in CRM', 2),
    (v_param_id, 'Failed to add proper tagging in chat', 3),
    (v_param_id, 'Unnecessary escalation', 4),
    (v_param_id, 'Not properly reviewing the conversation', 5);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Effective Time Management', 5, 8)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Holding Without Permission: Putting the customer on hold or stepping away to check something without asking for their consent first.', 0),
    (v_param_id, 'Missing Hold Timeframe: Failing to tell the customer how long they will need to wait or maintain holding time ("Please give me 2 minutes").', 1),
    (v_param_id, 'No Updates During Long Holds: Leaving the customer waiting past the promised time without checking in to give them an update on the progress.', 2),
    (v_param_id, 'Failing to Thank for Waiting : Forgetting to thank the customer for their patience when returning to the chat (e.g., "সাথে থাকার জন্য আপনাকে ধন্যবাদ").', 3),
    (v_param_id, 'Unnecessary or Repeated Holds : Putting the customer on hold too many times, or holding to check basic information that should already be easily accessible.', 4);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Closing and Further Assistance', 8, 9)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Ending chat without asking if the customer has other concerns, or closing without resolution', 0),
    (v_param_id, 'Did not explain the next step, leading to customer uncertainty.', 1),
    (v_param_id, 'Rushing the Chat Closure.', 2);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Compliance and Policy Adherence', 7, 10)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Sharing confidential information or violating data privacy.', 0),
    (v_param_id, 'Failed to adhere to standard SOP(s).', 1),
    (v_param_id, 'Failed to process refund correctly.', 2),
    (v_param_id, 'Exhibiting unprofessional or rude behavior (Interrupting, Using Slang, Not Taking Responsibility).', 3),
    (v_param_id, 'Violating overall company policies or legal guidelines.', 4);

  -- Fatal parameters
  insert into fatal_parameters (rubric_id, description, severity, sort_order) values
    (v_rubric_id, 'Sharing confidential information', 'critical', 0),
    (v_rubric_id, 'Failed to adhere SOP(s)', 'critical', 1),
    (v_rubric_id, 'Failed to process refund correctly', 'critical', 2),
    (v_rubric_id, 'Exhibiting unprofessional or rude behavior (Interrupting, Using Slang, Not Taking Responsibility)', 'critical', 3),
    (v_rubric_id, 'Violating company policies or legal guidelines', 'critical', 4);
end $$;

-- ================================================================
-- 3. CX Inbound & Engagement — CX Inbound, Engagement — 100 pts
-- No category grouping in source — single umbrella category.
-- ================================================================
do $$
declare
  v_rubric_id uuid;
  v_cat_id uuid;
  v_param_id uuid;
begin
  insert into rubrics (name, version, total_points, is_active)
  values ('CX Inbound & Engagement', 1, 100, true)
  returning id into v_rubric_id;

  insert into team_rubric_mapping (team_name, rubric_id) values
    ('CX Inbound', v_rubric_id),
    ('Engagement', v_rubric_id);

  insert into rubric_categories (rubric_id, name, sort_order)
  values (v_rubric_id, 'All Parameters', 0)
  returning id into v_cat_id;

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Greeting and Opening', 3, 0)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to greet according to script, protocol', 0),
    (v_param_id, 'Late greetings (exceeding a 3-second buffer)', 1),
    (v_param_id, 'Lacked enthusiasm or liveliness in the interaction', 2);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Hold/Transfer Procedure', 2, 1)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to adhere to the hold procedure (exceeding 60 seconds)', 0),
    (v_param_id, 'Did not follow the script for communication before and after returning from hold', 1);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Active Listening', 4, 2)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to acknowledge responses or remained inactive while listening', 0);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Probing Questions', 8, 3)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Did not inquire about any prior communication with an academic counselor', 0),
    (v_param_id, 'Did not perform all troubleshooting steps or clear cache or cookies', 1),
    (v_param_id, 'Failed to ask specific questions to accurately identify the problem', 2),
    (v_param_id, 'Did not identify why the customer was not interested in enrolling in the course', 3);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Issue Identification and Resolution', 4, 4)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to identify the customer''s objective in a timely manner', 0);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Product Features and Pricing Explanation', 15, 5)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to provide complete course details (number of classes, exams, class routine, duration)', 0),
    (v_param_id, 'Failed to share the main features and unique selling points (USP) of the relevant courses', 1),
    (v_param_id, 'Did not demonstrate the effectiveness of Shikho''s specialized teachers compared to local teachers', 2),
    (v_param_id, 'Failed to show a demonstrative calculation of the course price', 3),
    (v_param_id, 'Did not compare the course price with local or offline alternatives', 4);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Sales Conversion/ Conversation Sumarization/Lead Escalation', 15, 6)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to confirm whether the customer showed interest in purchasing the product', 0),
    (v_param_id, 'Did not seek an appointment or properly follow up on rescheduling', 1),
    (v_param_id, 'Failed to accurately escalate the lead in the sheet with complete information', 2);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Communication Clarity and Organization', 4, 7)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to confirm whether the customer showed interest in purchasing the product', 0),
    (v_param_id, 'Did not seek an appointment or properly follow up on rescheduling', 1),
    (v_param_id, 'Failed to accurately escalate the lead in the sheet with complete information', 2);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'No Hurry/No Interruption', 4, 8)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Spoke at an unclear or excessively fast or slow pace', 0);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Politeness and Rudeness Avoidance', 6, 9)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Used dictating, directive, or commanding language, lacking cordiality', 0),
    (v_param_id, 'Failed to express empathy when the customer mentioned a personal issues', 1),
    (v_param_id, 'Engaged in unprofessional activities (coughing, sneezing, yawning, laughing, side talking)', 2);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Use of Magic Words and Spontaneity', 4, 10)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Demonstrated a lack of enthusiasm, liveliness, or energy during the call', 0),
    (v_param_id, 'Did not use positive or polite phrases (please, sorry, kindly) and used negative words instead', 1);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Personalization and Attitude', 6, 11)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to show a positive mindset or willingness to assist the customer', 0),
    (v_param_id, 'Redirected the customer to another channel unnecessarily', 1);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'No Avoiding Tendency', 6, 12)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Intentionally avoided customer concerns or complaints', 0);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Accurate Escalation/Callback', 8, 13)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Failed to escalate the issue accurately and completely through the correct channels', 0),
    (v_param_id, 'Did not call back the customer after a dropped call', 1);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Call Closing and Further Assistance', 3, 14)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Did not ask the customer, "আমি কি তোমাকে বা আপনাকে বিষয়টি বোঝাতে পেরেছি "', 0),
    (v_param_id, 'Failed to ensure the call ended with the proper closing script', 1);

  insert into rubric_parameters (category_id, name, points, sort_order)
  values (v_cat_id, 'Wrap-Up Code Selection', 8, 15)
  returning id into v_param_id;
  insert into rubric_error_attributes (parameter_id, description, sort_order) values
    (v_param_id, 'Did not tag the correct call wrap-up code or disposition on time', 0);

  -- Fatal parameters
  insert into fatal_parameters (rubric_id, description, severity, sort_order) values
    (v_rubric_id, 'Failed to end the call within 5 seconds after the closing statement', 'major', 0),
    (v_rubric_id, 'Used inappropriate or unprofessional examples during the call', 'critical', 1),
    (v_rubric_id, 'Failed to maintain professional and organized language throughout the call', 'critical', 2),
    (v_rubric_id, 'Transferred the lead to another team with the intention of meeting sales targets improperly', 'critical', 3),
    (v_rubric_id, 'Made false promises or commitments to the customer', 'critical', 4),
    (v_rubric_id, 'Made an error regarding course enrollment or refund processes', 'critical', 5),
    (v_rubric_id, 'Engaged in inappropriate or flirtatious behavior with the customer', 'critical', 6),
    (v_rubric_id, 'Failed to engage with the customer or intentionally ignored their concerns', 'critical', 7),
    (v_rubric_id, 'Used abusive, sarcastic, pinching, rude, or loud words and tone', 'critical', 8),
    (v_rubric_id, 'Customer Manager was absent throughout the interaction', 'critical', 9),
    (v_rubric_id, 'Call was disconnected unexpectedly or improperly', 'critical', 10),
    (v_rubric_id, 'Repeated use of abusive, sarcastic, pinching, offensive, rude, loud word and voices', 'critical', 11);
end $$;

-- ================================================================
-- Verification query — run after the inserts above to confirm each
-- rubric's parameter points sum to its total_points.
-- ================================================================
-- select r.name, r.total_points,
--        (select coalesce(sum(p.points), 0)
--         from rubric_parameters p
--         join rubric_categories c on c.id = p.category_id
--         where c.rubric_id = r.id) as points_assigned
-- from rubrics r
-- where r.name in ('Telesales Scorecard', 'CX Non-Voice', 'CX Inbound & Engagement');
