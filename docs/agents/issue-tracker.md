# Issue tracker: GitHub

Issues and specs live in Davi942/Bet-fake. Use the gh CLI.

## Conventions

- Verify the target with `gh repo view --json nameWithOwner`.
- Create issues with `gh issue create --repo Davi942/Bet-fake`.
  For multiline bodies, write a temporary file and use --body-file.
- After creating each ticket, add it to Davi942's Project 1:
  `gh project item-add 1 --owner "@me" --url <URL da issue>`
  The authenticated account must be Davi942.
- If adding a ticket to the project fails, retain the issue and
  report the pending project addition; do not create a duplicate.
- Read: `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open`.
- Comment: `gh issue comment <number> --body-file <path>`.
- Labels: `gh issue edit <number> --add-label "<label>"`
  or `--remove-label "<label>"`.
- Before closing, post the explanation, then run
  `gh issue close <number>`.
- Link child tickets using native sub-issues when available.
  Otherwise, put `Part of #<parent>` in the child and a task
  list in the parent.
- Track blockers using native issue dependencies when available.
  Otherwise, put `Blocked by: #<number>` in the ticket.
  A ticket is unblocked when all blockers are closed.

## Pull requests as a triage surface

PRs as a request surface: no.

## Skill operations

"Publish to the issue tracker" means create a GitHub issue
and add it to Project 1.

"Fetch the relevant ticket" means read the GitHub issue.
