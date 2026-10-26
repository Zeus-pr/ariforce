# Use cases (derived from vendor workflows above)
## User stories
**Rep (MR)**
- Punch in with GPS and a selfie before 9:30, or my manager gets a late alert.
- See today's approved TP, then check in at each doctor (geofenced) and log products, samples and feedback in under 60 s.
- Add a new doctor from the field, which goes to my manager for approval.
- Submit my monthly TP by the 25th with every date filled.
- Claim TA/DA calculated from my work type and distance.

**Area manager (ABM/ASM)**
- Approve or return TPs, DCR edits, new doctors and leave from one inbox.
- Log joint work and evaluate the rep.
- See a "Needs Attention" list: no punch-in, call average below norm, A-class doctors missed this cycle.

**Regional/Zonal**
- Compare HQs and areas on coverage, call average and expense per call; drill down to a rep.
- Approve escalated expenses beyond area limits.

**National (NSM)**
- Company KPIs by division and brand: doctor reach, frequency compliance, POB, secondary vs target.

**Admin/HO**
- Import masters from Excel; configure hierarchy, work types, rate cards and holidays.
- Search the audit trail; export the UCPMP sample/gift register.

## Workflows
1. **Day in the life of an MR:** punch in, review the TP for the day, travel, then for each call: check in (geofence), detail, give samples (cap checked), record POB, check out. Then a chemist RCPA, punch out, submit DCR (locks), with TA/DA auto-drafted.
2. **Monthly TP cycle:** from the 20th, copy STP to MTP and fill all dates. Submit, then the ABM approves or returns with comments (then RBM if configured). On the 1st the TP is locked and DCRs prefill from it. Any deviation needs a reason or an approval request.
3. **Expense cycle:** daily auto-draft from DCR work type and distance, add bills, submit the month, then ABM approves, then RBM if over limit, then HO/accounts mark it paid. Everything is audit-logged.
4. **Sample issue:** HO allocates per rep per month and the rep acknowledges receipt. At the call: is the doctor verified? Is there cap headroom? If so, issue and capture acknowledgement. Month end: the ledger balances, then locks.
5. **Secondary sales:** the stockist (or the rep for them) uploads sales and closing stock monthly. The system maps it to HQ/brand and compares with target and primary from ERP.
