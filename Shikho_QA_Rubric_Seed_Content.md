# Shikho QA Rubric Seed Content

Complete, verified parameter/error-attribute/fatal-error content for all three rubrics, extracted directly from Jamil's source files and confirmed corrections. Matches the schema built in schema_003_rubrics.sql (design doc §3).

**Instruction for Claude Code:** write `schema_004_seed_rubrics.sql` from this content — one row in `rubrics` per rubric below, `team_rubric_mapping` rows per team listed, then `rubric_categories` → `rubric_parameters` → `rubric_error_attributes` in order, then `fatal_parameters` with the given severities. Preserve sort order top to bottom as listed. Verify each rubric's parameter points sum to 100 before finalizing (all three already confirmed to sum correctly here).

## Telesales Scorecard

**Teams:** Telesales, Retention, TS3P, BPO
**Total points:** 100

### Call opening and Rapport Building
**Call Opening** — 2 pts
- Failed to greet according to script, protocol
- Late Greetings (03 Sec buffer time)
- Failed to address with student's name and AC name
- Failed to mention Designation and the brand name

**Rapport Building** — 7 pts
- Failed to disclose the purpose of the Call
- Ask proper probing questions to identify Strong Subjects / Weak Subjects, Reason for weakness, and Ambition
- Failed to do student research (Number of Tuition, Parents Profession, Decision Maker)
- Failed to build connectivity with students/guardian

### Lead Relevance
**Pitch Personalization Based on Lead Behavior** — 8 pts
- Failed to refer to the student’s/guardian’s recent activity (e.g., app video watched, trial class joined) during the pitch.
- Failed to connect recent activity to their interests, subject preferences, or motivation to study with us

### Product and Benefits
**Features & Benefits** — 12 pts
- Failed to clearly highlight the main features of the course (Live & Recorded Classes, Animated Videos, Report Card, Practice & Live MCQs, Class & Smart Notes)
- Failed to share the complete course information with TnC (Number of classes/Exams/Weekly Class Routine/Class and Course Duration/Subjects/Teachers)
- Failed to share specialized teacher details (names, subject relevance, profile/background, and comparison with local teachers)
- Failed to relate features to the student’s life and explain how it can improve results, learning, and subject expertise.

**Price Demonstration** — 8 pts
- Failed to show demonstrative calculation of price effect (Offering right products according to financial capabilities)
- Failed to show Price comparison with offline/Local Teachers

### Negotiation and Rebuttals
**Handling Objection & Overcome the barriers** — 10 pts
- Failed to solve or advice the solution where applicable
- Failed to reassure that the compliant/barriers has been overcomed

**Generate Interest and Create Urgency** — 8 pts
- Failed to promote free trial/App experience or send relevant materials via WhatsApp to spark interest
- Failed to highlight Shikho AI, Doubt Solving, Archive Courses or other add-ons in an effective manner
- Failed to use offers (Discounts, Early Bird, Gifts) to create urgency or make the student feel exclusive

### Call Comprehension & Sales Closing
**Call Comprehension** — 5 pts
- Failed to ensure Student/Guardian engagement in the call

**Sales Closing (Conv. Summarization & Ask for sale)** — 7 pts
- Failed to summarize the call and use effective sales tactics to close the deal
- Failed to Seek an appointment (Failed to ask for rescheduled time/Rightly follow up)

### Professionalism & Call Courtesy
**Soft Skill & Demonstrating Empathy** — 10 pts
- Failed to avoid interruptions
- Failed to avoid negative/impolite words and use magical words
- Failed to avoid "missing of apology or empathy/excessive apology
- Failed to ask for information in a requesting/humble tone
- Failed to avoid using dictating/directive/authoritative expressions

**Speech quality, Communication & Effective Listening** — 5 pts
- Failed to maintain Pace, Pitch, and Voice Clarity
- Failed to avoid Local accent/mumbling
- Failed to display good and easy sentence construction/correct pronunciation or avoid jargon
- Failed to avoid unprofessional/causal activities (coughing/sneezing/yawning/sighing/laughing/side talking)
- Failed to acknowledge responses/avoid being inactive while listening
- Failed to speak confidently about Shikho's offerings or explain convincingly why a student/guardian should choose Shikho
- Failed to show liveliness (robotic/rehearsed/scripted/clumsy/drowsy/moody/lethargic/Awkward Pause-5 sec)

### Utilize CRM Features Effectively
**Lead Stage Update Accuracy** — 5 pts
- Failed to update lead stage correctly
- Failed to update Employee lead DND status properly

**CRM Profile Management Accuracy** — 3 pts
- Failed to update class Information accurately
- Failed to correct or update Student’s Name
- Failed to add an alternative mobile number where applicable

**CRM Task & Follow-Up Accuracy** — 5 pts
- Failed to complete assigned tasks properly
- Failed to create Follow-Up tasks where necessary

**Documentation & Notes Quality** — 3 pts
- Failed to capture or input notes accurately
- Failed to maintain professionalism in note-taking

### Call Closing & Wrap-up
**Call Closing & Wrap-up** — 2 pts
- Failed to ensure a standard closing script in all eligible calls to enhance referral opportunities (well-placed clear and enthusiastic)
- Failed to input correct CQC/Wrap-up or Disposition the call on time

### Fatal Parameters — Telesales Scorecard

| Description | Severity |
|---|---|
| Failed to share correct/complete information with customers which has a monetary impact | Critical |
| Failed to avoid eating, drinking, laughing, or making unnecessary noise/side talk during the conversation | Major |
| Failed to avoid using abusive language, sarcastic, pinching, offensive, rude, loud word and voices | Critical |
| Failed to avoid ignoring Intentional Customer or Lack of Engagement | Critical |
| Failed to avoid flirting with the customer | Critical |
| Failed to avoid any incorrect course enrollment or refund issues | Critical |
| Failed to avoid False commitment | Critical |
| Failed to avoid transferring leads to another academic counselor with the intention of meeting sales targets | Critical |
| Failed to Maintain organized and professional language in all call notes in CRM for accuracy and coherence | Major |
| Failed to avoid unprofessional examples | Critical |
| Failed to maintain CRM Hygine properly | Critical |
| Misclassification of leads due to the selection of incorrect stages | Critical |
| Failed to ensure calls conclude within 5 seconds after closing | Major |

---

## CX Non-Voice

**Teams:** CX Non-Voice
**Total points:** 100

**Greetings and Opening of the chat** — 5 pts
- Failed to greet according to the script or protocol
- Failed to properly address the customer according to protocol
- Delayed Greetings (with a 90-second allowable buffer window)

**Effective Communication and Sentense Construction** — 10 pts
- Presence of spelling mistakes during the interaction.
- Using dictating, directive, authoritative, or commanding language.
- Failing to display good sentence construction and correct punctuation.
- Syntax errors or obvious typing mistakes.
- Wasting the customer's time due to unclear communication.

**Professionalism and Empathy** — 10 pts
- Sounding Robotic or Scripted: Overusing unpersonalized templates, making the customer feel they are talking to a bot.
- Failing to Show Empathy: Missing the chance to apologize or acknowledge the customer's frustration when they experience a delay, error, or inconvenience.
- Arguing or Blaming the Customer : Pushing back inappropriately, failing to calm a tense situation, or using words that make the customer feel like the problem is their fault.
- Using an Unprofessional Tone: Being sarcastic, passive-aggressive, or overly casual (such as using slang or too many emojis) during the interaction.
- Ignoring Provided Information (Poor Active Listening):Not reading the chat history carefully and asking the customer to repeat details they have already shared.

**Probing and Concern Assessments** — 8 pts
- Failed to handle the chat expertly
- Failing to address customer concerns
- Failed to troubleshoot customers technical issues

**Information Accuracy and Completeness** — 12 pts
- complete course information with TnC (Number of classes or Exams, Weekly Class Routine, Class and Course Duration, Subjects, Teachers)

**Product (FnB) or Solution Presentation** — 10 pts
- Emphasized product features rather than focusing on how those features turns into customer benefit
- Failed to demonstrate the effectiveness of specialized teachers compared to local teachers
- Failed to show price effect demonstrative calculation
- Failed to show Price comparison with offline or Local Teachers
- Failed to give alternative solution where necessary

**Sales Conversion and Upselling Skills** — 15 pts
- Failure to Identify Sales Opportunities when the customer shows interest
- The agent does not effectively ask for the sale, leaving the conversation open-ended
- Failed to handle the customer's concerns well, which caused unsure about buying
- Failed to connect with the customer, which caused less interest in the product
- Did not utilize available sales tools or resources effectively to enhance the sales pitch

**Documentation and Follow-Up Accuracy** — 10 pts
- Failed to escalate the issue to the right concern
- Failed to adhere the call back request of customer
- Failed to capture all information correctly and completely in CRM
- Failed to add proper tagging in chat
- Unnecessary escalation
- Not properly reviewing the conversation

**Effective Time Management** — 5 pts
- Holding Without Permission: Putting the customer on hold or stepping away to check something without asking for their consent first.
- Missing Hold Timeframe: Failing to tell the customer how long they will need to wait or maintain holding time ("Please give me 2 minutes").
- No Updates During Long Holds: Leaving the customer waiting past the promised time without checking in to give them an update on the progress.
- Failing to Thank for Waiting : Forgetting to thank the customer for their patience when returning to the chat (e.g., "সাথে থাকার জন্য আপনাকে ধন্যবাদ").
- Unnecessary or Repeated Holds : Putting the customer on hold too many times, or holding to check basic information that should already be easily accessible.

**Closing and Further Assistance** — 8 pts
- Ending chat without asking if the customer has other concerns, or closing without resolution
- Did not explain the next step, leading to customer uncertainty.
- Rushing the Chat Closure.

**Compliance and Policy Adherence** — 7 pts
- Sharing confidential information or violating data privacy.
- Failed to adhere to standard SOP(s).
- Failed to process refund correctly.
- Exhibiting unprofessional or rude behavior (Interrupting, Using Slang, Not Taking Responsibility).
- Violating overall company policies or legal guidelines.

### Fatal Parameters — CX Non-Voice

| Description | Severity |
|---|---|
| Sharing confidential information | Critical |
| Failed to adhere SOP(s) | Critical |
| Failed to process refund correctly | Critical |
| Exhibiting unprofessional or rude behavior (Interrupting, Using Slang, Not Taking Responsibility) | Critical |
| Violating company policies or legal guidelines | Critical |

---

## CX Inbound & Engagement

**Teams:** CX Inbound, Engagement
**Total points:** 100

**Greeting and Opening** — 3 pts
- Failed to greet according to script, protocol
- Late greetings (exceeding a 3-second buffer)
- Lacked enthusiasm or liveliness in the interaction

**Hold/Transfer Procedure** — 2 pts
- Failed to adhere to the hold procedure (exceeding 60 seconds)
- Did not follow the script for communication before and after returning from hold

**Active Listening** — 4 pts
- Failed to acknowledge responses or remained inactive while listening

**Probing Questions** — 8 pts
- Did not inquire about any prior communication with an academic counselor
- Did not perform all troubleshooting steps or clear cache or cookies
- Failed to ask specific questions to accurately identify the problem
- Did not identify why the customer was not interested in enrolling in the course

**Issue Identification and Resolution** — 4 pts
- Failed to identify the customer’s objective in a timely manner

**Product Features and Pricing Explanation** — 15 pts
- Failed to provide complete course details (number of classes, exams, class routine, duration)
- Failed to share the main features and unique selling points (USP) of the relevant courses
- Did not demonstrate the effectiveness of Shikho’s specialized teachers compared to local teachers
- Failed to show a demonstrative calculation of the course price
- Did not compare the course price with local or offline alternatives

**Sales Conversion/ Conversation Sumarization/Lead Escalation** — 15 pts
- Failed to confirm whether the customer showed interest in purchasing the product
- Did not seek an appointment or properly follow up on rescheduling
- Failed to accurately escalate the lead in the sheet with complete information

**Communication Clarity and Organization** — 4 pts
- Failed to confirm whether the customer showed interest in purchasing the product
- Did not seek an appointment or properly follow up on rescheduling
- Failed to accurately escalate the lead in the sheet with complete information

**No Hurry/No Interruption** — 4 pts
- Spoke at an unclear or excessively fast or slow pace

**Politeness and Rudeness Avoidance** — 6 pts
- Used dictating, directive, or commanding language, lacking cordiality
- Failed to express empathy when the customer mentioned a personal issues
- Engaged in unprofessional activities (coughing, sneezing, yawning, laughing, side talking)

**Use of Magic Words and Spontaneity** — 4 pts
- Demonstrated a lack of enthusiasm, liveliness, or energy during the call
- Did not use positive or polite phrases (please, sorry, kindly) and used negative words instead

**Personalization and Attitude** — 6 pts
- Failed to show a positive mindset or willingness to assist the customer
- Redirected the customer to another channel unnecessarily

**No Avoiding Tendency** — 6 pts
- Intentionally avoided customer concerns or complaints

**Accurate Escalation/Callback** — 8 pts
- Failed to escalate the issue accurately and completely through the correct channels
- Did not call back the customer after a dropped call

**Call Closing and Further Assistance** — 3 pts
- Did not ask the customer, "আমি কি তোমাকে বা আপনাকে বিষয়টি বোঝাতে পেরেছি "
- Failed to ensure the call ended with the proper closing script

**Wrap-Up Code Selection** — 8 pts
- Did not tag the correct call wrap-up code or disposition on time

### Fatal Parameters — CX Inbound & Engagement

| Description | Severity |
|---|---|
| Failed to end the call within 5 seconds after the closing statement | Major |
| Used inappropriate or unprofessional examples during the call | Critical |
| Failed to maintain professional and organized language throughout the call | Critical |
| Transferred the lead to another team with the intention of meeting sales targets improperly | Critical |
| Made false promises or commitments to the customer | Critical |
| Made an error regarding course enrollment or refund processes | Critical |
| Engaged in inappropriate or flirtatious behavior with the customer | Critical |
| Failed to engage with the customer or intentionally ignored their concerns | Critical |
| Used abusive, sarcastic, pinching, rude, or loud words and tone | Critical |
| Customer Manager was absent throughout the interaction | Critical |
| Call was disconnected unexpectedly or improperly | Critical |
| Repeated use of abusive, sarcastic, pinching, offensive, rude, loud word and voices | Critical |

---
