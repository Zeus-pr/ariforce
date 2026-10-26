# Suggested GitHub issues (check for duplicates against #1–#13 before creating)
1. Generic approval engine (TP, DCR edit, doctor, leave, expense): one workflow table and approvals inbox. `phase-0, api`
2. Configurable work types and field cycle length: admin defines field/HQ/ex-HQ/outstation/meeting/transit. `phase-1-mvp, api, web`
3. TP calendar requires every date filled before submit: blocks submit until complete; auto week-offs/holidays. `phase-1-mvp, web, mobile`
4. STP → MTP copy: standard patch plan seeds the monthly plan. `phase-1-mvp, web`
5. Multi-session days in TP/DCR: more than one work type per date. `phase-1-mvp, api`
6. DCR prefilled from the approved TP with deviation reason. `phase-1-mvp, api, mobile`
7. DCR lock at day close with a correction-request flow. `phase-1-mvp, api, compliance`
8. Doctor geo-tag and geofenced check-in (configurable radius), with out-of-fence flags. `phase-1-mvp, api, mobile`
9. Doctor A/B/C grade with required visit frequency per grade. `phase-1-mvp, api, web`
10. Field-added doctor approval and duplicate detection. `phase-1-mvp, api, web`
11. Doctor registration verification status (NMC/state council), gates sampling. `phase-1-mvp, compliance, api`
12. Excel master import with validation report (doctors, chemists, stockists, patches, hierarchy). `phase-1-mvp, web, api`
13. KPI views: call avg, coverage, frequency compliance, missed doctors, DCR compliance (Postgres views). `phase-1-mvp, api`
14. Manager "Needs Attention" dashboard: exception list scoped by hierarchy. `phase-1-mvp, web, design`
15. Hierarchy drill-down dashboards with breadcrumb and Excel/PDF export. `phase-1-mvp, web`
16. Attendance/check-in map for a day with flagged pins. `phase-1-mvp, web`
17. Doctor 360 page: profile, visits, samples vs cap, products detailed. `phase-1-mvp, web, design`
18. Notification jobs: late punch-in, pending approvals, missed DCR, birthdays. `phase-1-mvp, api`
19. DPDP notice and consent for location/selfie, with retention policy. `phase-0, compliance`
20. Sample allocation, issue, acknowledgement and per-doctor UCPMP cap (12 packs/drug/yr, verify). `compliance, api` (P2)
21. Monthly sample ledger reconciliation and lock. `compliance, web` (P2)
22. TA/DA auto-calc from distance rate card and work type. `api, web` (P2)
23. POB and RCPA capture at chemist calls. `mobile, api` (P2)
24. Stockist secondary sales and closing-stock upload. `web, api` (P2)
25. UCPMP annual self-declaration export (samples, gifts, CME). `compliance, web` (later)
