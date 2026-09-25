# Questions for Jamil — overnight build, Friday 25 Sep 2026

Everything below was **built so it does not depend on a guess** where the answer is compliance-sensitive,
and uses a clearly marked placeholder where it isn't. Nothing here blocks testing — but please answer
before any of it is relied on.

Answer by replying with the number and your choice; each says what changes.

---

## A. Vintage slabs (§6.1) — ANSWERED

The design lists the names (1st Month, 1-3, 3-6, 6-9, 9-12 Months, 1 Year Plus) but never the day counts.

**Q1 — answered:** 1st Month 0–30 · 1-3 Months 31–90 · 3-6 Months 91–180 · 6-9 Months 181–270 · 9-12 Months 271–365 · 1 Year Plus 365+. **Applied**, with one reading to confirm: "365+" would overlap 9-12 Months at day 365, so 1 Year Plus starts at **366** (each day must be in exactly one slab). Day 90 now falls in 1-3 Months, so the old "<90 / ≥90" split no longer coincides with a slab edge.

## B. RYG status (§6.2) — placeholders that affect who is Red

**Q2. Window.** "Rolling average audit score" — over how many weeks? I used the **last 4 completed sales weeks** (Sat–Fri).

**Q3. Green bar.** Only the 70% pass/yellow boundary was confirmed. **90% for Green is still the design doc's "e.g." figure.** What is Green's minimum?
(Correct with `select set_status_thresholds(null, <green>, 70);`.)

**Q4. Which thresholds.** I band everyone against the one org-wide row. A rubric-specific row, if you ever add one, is not consulted (an agent's audits can span rubrics). OK?

**Q5. Agents with no audit in the window.** They get **no status** rather than an invented one. Should "no audits" instead show as something (e.g. grey / "unrated")?

**Q6. Which audits count.** Every non-draft audit (submitted / acknowledged / disputed / resolved). Should a *disputed* audit be left out until resolved?

**Q7. OJT / re-training agents.** They are included if they have audits. Should RYG apply to agents still in OJT at all?

## C. PIP (§6.4) — compliance-sensitive, so the model refuses to guess

**Q8. How is "revenue" measured for selection?** Two settings are deliberately **empty** and **suggestions will not run until you set them** (`/admin/pip` → Policy):
- the **window** — how many completed sales weeks before the cycle starts (e.g. 4);
- the **unit** — is the 400 benchmark in **BDT or USD**? (400 BDT is tiny; 400 USD ≈ 44,000 BDT.)

**Q9. Benchmark meaning.** I treat `revenue_benchmark` as a **ceiling**: only agents *below* it can be suggested, then the bottom N per site. Is that right, or should bottom-N be picked regardless of the benchmark?

**Q10. Partial revenue.** Only about 13% of sales are currently matched to an agent (the roster is small), so most agents' revenue reads far below reality. Suggestion generation **requires an explicit acknowledgement** every time and reports the matched share. Should it instead be **blocked entirely** below some matched percentage (and what %)?

**Q11. Who can see what.**
- Suggestions and exclusions: **QA Manager / Super Admin / QA Auditor only**.
- Team Lead / Manager / the agent see a PIP **only once approved**.
- Team Lead feedback is visible to QA, the Team Lead and the Manager — **never the agent**.
Is that right? Should the agent see their own PIP at all (I allow it once approved), and should a Team Lead see *suggestions* for their own team before approval?

**Q12. Who approves.** Super Admin and QA Manager only (same as policy admin). Should QA Auditors be able to?

**Q13. Incentive downgrade.** `incentive_downgraded` can be set only when a PIP is marked **failed**. Is that when it applies?

**Q14. Overlap rule.** An agent already inside an approved, still-running PIP is not suggested again. Anything else that should exclude someone automatically (e.g. on leave)? Today that is a manual "Exclude" with a reason.

**Q15. Sites.** Bottom-N is per `site_name`; an agent with no site is grouped as "(no site)". Should agents without a site be blocked from selection?

---

## What I did NOT do (by your instructions)

- **No emails or notifications** for PIP — nothing in the PIP code can send one.
- **No full backfill** — only the one bounded daily-sync run.
- Nothing is committed; everything is in the working tree for your review.
