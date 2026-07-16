# Contributing to designjobs.cv

First off — thank you! This project exists because of people like you. Whether you're submitting a job, sharing what an interview process was like, fixing a bug, or suggesting a feature, every contribution matters.

## Community

Join our Slack to connect with other designers, share jobs, and discuss contributions:

💬 **[Join Slack](https://join.slack.com/t/designjobs-healthcare/shared_invite/zt-3qc39yhhw-ssTCfSUEXoLHvVVXTYwS_Q)**

## Code of Conduct

Be kind, be respectful, be constructive. This board exists to make job searching less brutal — let's treat each other with the same care.

## How to Contribute

### 🎯 Submit a Job Listing

**Easiest way:** Use the **Submit a Job** button on [designjobs.cv](https://designjobs.cv/jobs). It creates a GitHub issue with the job details for a maintainer to review.

**Via Pull Request:**

1. Fork this repo
2. Add your job to `src/data/jobs.json`
3. Follow the schema below
4. Submit a PR with a clear title (e.g., "Add: Senior Product Designer at Linear")

**Job schema:**

```json
{
  "id": "company-role-kebab-case",
  "title": "Job Title",
  "company": "Company Name",
  "companyUrl": "https://company.com",
  "level": "Entry | Junior | Mid | Senior | Staff | Lead | Principal | Director",
  "locationType": "Remote | Hybrid | On-site",
  "location": "City, State or Country",
  "url": "https://direct-link-to-job-posting.com",
  "postedAt": "YYYY-MM-DD",
  "vertical": "Healthcare | AI | Fintech | Climate | Consumer | Enterprise/SaaS | Gov/Civic | Education | Other",
  "employmentType": "Full-time | Contract | Freelance",
  "tags": ["relevant", "tags", "here"]
}
```

**Job listing guidelines:**
- Must be a **design role** (product design, UX design, UX research, content design, design engineering, design ops, etc.)
- Must link to the **company's own ATS or careers page** (no LinkedIn links, no aggregators)
- Must be an **active posting** (no expired listings)
- No recruiter/staffing agency posts — direct company listings only

Full vetting criteria live in [`docs/job-vetting-criteria.md`](docs/job-vetting-criteria.md).

### 📋 Share an Interview Process

Been through a company's interview loop? Use **"Share what I know"** on any job page. It's anonymous and structured — rounds, timeline, take-home, whether you heard back — no free-text reviews, just facts. Reports are filed as GitHub issues labeled `interview-process`, reviewed, and then shown on the job page.

### 🐛 Report a Bug

Use the **Feedback** link on the site, or [open an issue](https://github.com/cmonies/healthcare-jobs/issues/new) with:
- What you expected to happen
- What actually happened
- Browser/device info if relevant
- Screenshot if helpful

### 💡 Suggest a Feature

[Open an issue](https://github.com/cmonies/healthcare-jobs/issues/new) with the `enhancement` label. Describe the problem you're trying to solve and your proposed solution.

### 🛠️ Submit Code Changes

1. Fork the repo
2. Create a branch (`git checkout -b feature/your-feature`)
3. Make your changes
4. Test locally (`npm run dev`)
5. Commit with a clear message
6. Push and open a PR

**Development setup:**

```bash
git clone https://github.com/YOUR-USERNAME/healthcare-jobs.git
cd healthcare-jobs
npm install
npm run dev
```

Open [http://localhost:4321](http://localhost:4321) to see the site.

## What Makes a Good Contribution

- **Jobs:** Verified, active listings at real companies
- **Process reports:** Honest, factual, first-hand
- **Code:** Clean, accessible, follows existing patterns
- **Issues:** Clear, specific, reproducible

## Review Process

All contributions are reviewed by a maintainer before merging. We aim to review PRs within a few days. Job submissions and process reports are typically reviewed faster.

## Questions?

Drop a message in [Slack](https://join.slack.com/t/designjobs-healthcare/shared_invite/zt-3qc39yhhw-ssTCfSUEXoLHvVVXTYwS_Q) or [open an issue](https://github.com/cmonies/healthcare-jobs/issues/new) — we're happy to help.

---

Thanks for helping build a better job board for the design community 💙
