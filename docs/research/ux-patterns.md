# UX and dashboard patterns
| Pattern | Seen in | Web MVP? |
|---|---|---|
| Calendar TP grid with status per date (planned/approved/deviation/leave) and a blocked submit until complete | SAN | Yes |
| Single approvals inbox with bulk approve and return-with-comment | SAN workflow | Yes |
| "Needs Attention" exception list instead of raw tables | ZOU | Yes |
| Hierarchy drill-down (national → zone → region → area → rep) with a breadcrumb | ZOU, SAN | Yes |
| Map of the day's punch-ins and check-ins, with out-of-geofence calls flagged | BZ, ZOU | Yes (static pins; live tracking later) |
| Doctor 360: profile, visit history, samples given vs cap, last products detailed | SAN, PAR | Yes |
| Cap meter per doctor and SKU (near cap / at cap) | PAR | P2 |
| Mid-cycle gap alert ("Day 15: 40% of A-class doctors unvisited") | ZOU | P1 (nightly job) |
| Voice/free-text call notes with AI summary | VV, SF | Later |

## KPIs (standard Indian pharma definitions; confirm formulas with Arighna)
- **Call average** = doctor calls ÷ field-working days.
- **Coverage %** = unique listed doctors met at least once in the cycle ÷ listed doctors.
- **Frequency compliance %** = doctors met at their required frequency (e.g. A = 2–3×, B = 2×, C = 1×) ÷ listed doctors.
- **Missed doctors** = listed doctors with zero calls this cycle (by class).
- **Doctor reach** = unique doctors met across the team ÷ doctor universe in the territory.
- **Strike rate / productive call %** = calls with POB/order ÷ total chemist calls.
- **DCR compliance** = days with a DCR submitted on time ÷ working days.
- **TP adherence** = calls matching the planned patch/doctor ÷ total calls.
- **Expense per call**, **sample utilisation %**, **POB vs target**, **secondary vs target**.

All of these come from DCR, TP and masters, so they are feasible in the web MVP as Postgres views. Secondary and RCPA KPIs wait for P2.
