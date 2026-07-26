# SANY Talent Match — Agentic Design

## Product contract

The product is a recruiter copilot, not an automatic hiring decision-maker. It must read visible LinkedIn profile data into a reviewable record, compare it with every active HC, cite concrete evidence, name missing evidence, and preserve reports with recruiter decisions. It must never score on age, nationality, gender, ethnicity, disability, or other protected attributes.

Graduation and career dates can only be displayed as a neutral timeline for manual review where lawful. They cannot change ranking, score, or recommendation.

## Runtime workflow

```text
LinkedIn profile
  -> Profile Reader
  -> Normalizer + completeness gate
  -> HC Retriever
  -> Match Reasoner
  -> Evidence / risk verifier
  -> Ranked recruiter report + history snapshot
  -> Recruiter feedback loop
```

### Profile Reader

The extension reads the active candidate only on recruiter action. It captures profile identity, headline, location, visible experience, education, dates, and public descriptions. It uses LinkedIn's actual profile scroll container rather than undocumented network payloads.

### Normalizer and completeness gate

Raw page sections become a canonical candidate record. The system confirms identity and URL, labels missing location as `unknown`, shows experience and education counts, marks career duration as an estimate, and never silently infers missing facts.

### HC retrieval

The HC store is the source of truth for title, location, function, business unit, priority, headcount, and full JD. It first filters closed roles and explicit geographic impossibilities, then passes the remaining original JD text to the reasoner.

### Match reasoner

The local Codex agent evaluates each plausible role separately for functional/domain fit, seniority, location, explicit JD requirements, transferable experience, and risks. It returns at most five roles. Every positive claim must be grounded in captured profile evidence; missing requirements become interview checks, not invented skills.

### Verifier and report contract

Before rendering, the broker validates the JSON response and role IDs. Every report contains a recruiter-priority score, verdict, concise conclusion, evidence bullets, risks / interview checks, separate location and experience assessments, and a timestamped candidate snapshot. The UI must not show fabricated component scores.

### Feedback loop

The next UI increment adds **shortlist**, **not suitable**, **contacted**, **hired**, and **correct profile data** actions. Each is saved with a recruiter rationale and becomes a preference signal for future ranking without overwriting original evidence or the JD.

## Data boundaries

- Current build sends data only to the local broker at `127.0.0.1:8787`.
- The broker invokes the signed-in local Codex CLI in read-only mode; LinkedIn credentials and page sessions are not sent to it.
- History is created only after a report is generated and stores the profile snapshot, reports, and timestamp.
- Any future shared service requires authentication, encryption, access control, audit logs, retention/deletion controls, and a visible recruiter notice.

## Quality gates

Reject or flag output if it references a non-active role ID, lacks profile-grounded evidence, presents an unobserved skill as fact, uses protected-attribute information, or treats missing location/experience as a fact.

## Delivery sequence

1. Current: robust profile read, local Codex reasoning, evidence/risk report, history.
2. Next: HC pre-filter, response verifier, recruiter decisions, confidence display.
3. Production: authenticated service, encrypted persistence, audit trail, retention controls, and evaluation against recruiter-labelled historical outcomes.
