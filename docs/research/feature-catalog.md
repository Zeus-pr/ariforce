# Feature catalog for AriForce
Priority: M = Must, S = Should, C = Could. Phase: P0 = foundation, P1 = MVP, L = later. Source keys: SAN = SANeForce, ZOU = Zoulte, BZ = Bizzfield, KIN = Kinematic, PM = PharmaMonitor, SP = SalesPort, VV = Veeva, SF = Salesforce LSC, PAR = Parikrama.

| Module | Feature | Pri | Phase | Seen in |
|---|---|---|---|---|
| Attendance/GPS | Punch in/out with GPS plus selfie | M | P1 | ZOU, PM |
| | Geofenced visit check-in against the doctor's tagged location (50–200 m) | M | P1 | BZ, softwaredekho |
| | Mock-location and root detection; one bound device per rep | M | P1 (app) | plan |
| | Live route tracking and distance travelled | S | L | ZOU Optimise |
| | Late-login alerts | S | P1 | ZOU |
| DCR | Doctor/chemist/stockist/joint-work calls: products detailed, samples, gifts, POB, feedback, duration | M | P1 | SAN, BZ |
| | DCR based on the TP (prefilled from the approved plan), with deviation reason | M | P1 | SAN |
| | Lock after day close or submit; edits only via a correction request | M | P1 | ZOU, SAN |
| | Non-field work types (meeting, training, transit, leave, holiday) | M | P1 | SAN |
| | Voice/free-text call notes with AI summary | C | L | VV, SF |
| Tour plan | Monthly TP on a calendar; every date must be filled before submit | M | P1 | SAN |
| | STP (standard plan) to MTP copy | S | P1 | SAN |
| | Multi-session days; auto week-offs/holidays | S | P1 | SAN |
| | Hierarchy approval; changing an approved TP needs approval | M | P1 | SAN |
| | Manager TP aligned with reps' plans (joint work) | S | L | SAN |
| Masters | Doctor (speciality, A/B/C grade, visit frequency, geo-tag, registration no., DOB/anniversary) | M | P0/P1 | ZOU, PAR |
| | Chemist, stockist, hospital, patch/cluster, HQ/territory | M | P0/P1 | all |
| | Add doctor from the field, approved by a manager (avoids duplicates) | M | P1 | softwaredekho |
| | Excel bulk import | M | P1 | plan |
| | Doctor verification status (NMC/state council) gating samples | S | P1 | PAR |
| Samples/gifts | Allocation depot→rep, issue to doctor, acknowledgement | M | L (P2) | BZ, SAN |
| | UCPMP cap: ≤12 packs per drug per doctor per year, enforced across reps | M | P2 | PAR (verify text) |
| | Monthly rep ledger (opening+received−given−returned = closing), lock | S | P2 | PAR |
| | Batch/expiry, expired returns | C | L | BZ |
| Expenses | TA/DA auto-calculated from a distance rate card and the HQ/ex-HQ/outstation work type | M | P2 | ZOU, PM |
| | Bills/photos, policy limits, approval chain | M | P2 | SAN |
| Orders/secondary | POB at chemist/stockist; order status | S | P2 | SAN, BZ |
| | Stockist secondary sales and closing-stock upload | S | P2 | SP |
| | RCPA (competitor brands, Rx counts, photo) | S | P2 | ZOU, KIN |
| Targets/incentives | Targets by brand/HQ; achievement vs target; incentive slabs | S | L | FieldAssist, SAN SFE |
| Leave | Apply/approve, balances, holiday calendar by state | M | P1/P2 | ZOU |
| E-detailing | Offline brand decks, slide-time analytics | C | L | ZOU, VV |
| MR evaluation | Manager joint-work assessment, quiz/survey | C | L | SAN |
| Dashboards/MIS | Call average, coverage, frequency compliance, missed doctors, "Needs Attention" | M | P1 | ZOU, PM |
| | Hierarchy-scoped rollups; Excel/PDF export | M | P1 | ZOU |
| | Custom report builder | C | L | SAN, ZOU |
| Approvals | One generic approval engine (TP, DCR edit, new doctor, leave, expense, deviation) | M | P0/P1 | SAN |
| Notifications | Pending-approval, missed-DCR, birthday/anniversary reminders | S | P1 | ZOU |
| | WhatsApp/SMS | C | L | softwaredekho |
| Offline | Full DCR/TP offline with sync (app) | M | P1 (app) | all |
| Integrations | ERP (Tally/SAP/Marg) for primary sales and stock | S | L | softwaredekho |
| Admin/config | Configurable work types, cycle length, fields, hierarchy, rate cards | M | P0/P1 | ZOU, SAN |
| Compliance/audit | Append-only audit log; DPDP consent and notice for location | M | P0 | PAR |
| | UCPMP self-declaration pack (samples, gifts, CME spend) | S | L | PAR |
