# Interview report review criteria

What community process reports (GitHub issues labeled `community-data` + `interview-process`)
are allowed onto job pages. The whole point of this feature is transparency **without**
Glassdoor-style toxicity — when in doubt, publish the structured facts and drop the prose.

## Hard rejections — never publish

- **Profanity, slurs, or extreme language of any kind.** No exceptions, no asterisked
  versions, no "mild" swearing. If an anecdote contains it, the anecdote does not publish.
  Do not rewrite it to remove the cussing — dropping it is the answer, rewriting puts
  words in the reporter's mouth.
- **Insults or characterizations of people.** "The interviewer was an idiot / rude /
  incompetent" — no. Behavior is fine, character is not: "the interviewer joined 20
  minutes late and hadn't read my portfolio" is publishable; "the interviewer was
  disrespectful" is not.
- **Serious allegations** (discrimination, harassment, anything illegal). A job board
  quote is not the right venue and we can't verify them. Reject the anecdote; if a report
  contains something genuinely alarming, flag it to Carmen instead of publishing.
- **Named or identifiable individuals in anecdote text.** Recruiter names belong in the
  structured contact field, never inside a quote — especially not attached to criticism.
- **PII** — emails, phone numbers, internal links.
- **Spam, self-promotion, or reports about the wrong company/role.**

## What makes an anecdote publishable

- **Process events, not verdicts.** Rounds, scheduling, communication, take-home scope,
  whether they paid, whether they responded. The reader should learn what will *happen*
  to them, not how to *feel* about the company.
- Negative experiences are absolutely allowed — ghosting, rescheduling, unpaid take-homes
  are exactly what candidates need to know. Factual negative ≠ toxic.
- Publish verbatim or not at all. Trimming leading/trailing whitespace is fine; editing
  meaning, tone, or wording is not.

## Structured fields (rounds, timeline, take-home, ghosting)

- Plausibility check: rounds 1–8, `roundTypes` from the controlled vocab, timeline from
  the fixed options. Anything else was tampered with — reject the report.
- Structured fields can merge even when the anecdote is rejected for language — salvage
  the facts, drop the prose.
- Conflicting reports: prefer the most recent; if reports disagree wildly, keep the
  structured data that at least two reports agree on and queue the outlier.
- `gotFeedback: false` (ghosting) is a heavy public signal — it needs either two
  independent reports or one report with a credible anecdote before it renders.

## Attribution

- Anecdotes render with `source` ("Interviewed here" / "Works here") from the reporter's
  relationship answer, and `date` as the report month (e.g. "Jun 2026"). Never anything
  that could identify the reporter.

## Volume

- Max 3 anecdotes merged per report wave; keep the newest, most informative ones. The
  page shows 2 with a "Read all" dialog, so quality beats quantity.
