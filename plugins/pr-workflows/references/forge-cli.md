# Forge CLI reference — GitHub (`gh`) and GitLab (`glab`)

Every PR skill in this config is forge-agnostic. Detect the forge once, then use
the matching column below. Never hardcode one forge's CLI into a skill.

## Detect the forge

```bash
git remote get-url origin   # github.com/... → gh,  gitlab.../ → glab
```

Or, from a script inside this plugin, use the shared helper, which also
normalises the response shapes the two forges disagree on:

```python
import os, sys
sys.path.insert(0, os.path.join(os.environ["CLAUDE_PLUGIN_ROOT"], "lib"))
import forge

forge_name = forge.detect_forge()          # "github" | "gitlab"
change_request = forge.view_change_request("42", forge_name)
```

## Vocabulary

| Concept | GitHub | GitLab |
| --- | --- | --- |
| The change | pull request (PR) | merge request (MR) |
| Its identifier | number | IID |
| Repo slug | `owner/repo` | `group/subgroup/repo` |
| Source → target | head → base | source → target |
| CI unit | check run / workflow | pipeline / job |

Skills say "change request" when they mean either, and "PR"/"MR" only when the
statement is genuinely forge-specific.

## Command mapping

| Operation | `gh` | `glab` |
| --- | --- | --- |
| Authenticate | `gh auth login` | `glab auth login` |
| Auth status | `gh auth status` | `glab auth status` |
| View (JSON) | `gh pr view <n> --json number,title,author,state,headRefName,baseRefName,headRefOid,url` | `glab mr view <iid> --output json` |
| List mine | `gh pr list --author @me` | `glab mr list --author=@me` |
| Diff | `gh pr diff <n>` | `glab mr diff <iid>` |
| Check out | `gh pr checkout <n>` | `glab mr checkout <iid>` |
| Create | `gh pr create --title T --body B --base main` | `glab mr create --title T --description B --target-branch main` |
| Edit title/body | `gh pr edit <n> --title T --body B` | `glab mr edit <iid> --title T --description B` |
| General comment | `gh pr comment <n> --body B` | `glab mr note <iid> --message B` |
| Approve | `gh pr review <n> --approve` | `glab mr approve <iid>` |
| Merge | `gh pr merge <n> --squash` | `glab mr merge <iid>` |
| Auto-merge on green | `gh pr merge <n> --auto --squash` | `glab mr merge <iid> --when-pipeline-succeeds` |
| CI status | `gh pr checks <n>` | `glab ci list` / `glab ci view` |
| CI logs | `gh run view <run-id> --log-failed` | `glab ci trace <job-id>` |
| Raw API | `gh api <path>` | `glab api <path>` |
| Current user | `gh api user` → `.login` | `glab api user` → `.username` |

## Where the two genuinely differ

**Inline diff comments.** GitHub takes `path` + `line` + `side` + `commit_id`.
GitLab needs a full `position` object including a `line_code` of
`SHA1(path)_{old_line}_{new_line}`. Do not hand-assemble either — call
`forge.post_inline_comment(...)`.

**Resolving a thread.** GitLab exposes it over REST
(`PUT .../discussions/<id>` with `resolved=true`). GitHub only exposes it over
GraphQL (`resolveReviewThread`), keyed by a thread node id rather than the REST
comment id. `forge.resolve_thread(...)` handles the mapping.

**Merge base.** GitLab returns `diff_refs.base_sha` directly. GitHub does not, so
the helper computes `git merge-base origin/<base> <head>` locally — which means
the repository must be fetched for the value to be correct.

**Approval semantics.** A GitLab approval is a standalone action; a GitHub
approval is a review event. `gh pr review --approve` cannot approve your own PR,
while GitLab only blocks it when the project requires it.

## Rules

- Resolve the forge once at the start of a flow and pass it down — do not
  re-detect it in every step.
- Never read a token out of CLI config. Route API calls through `gh api` /
  `glab api`, which already hold the credentials.
- When a skill can only work on one forge, say so in its description and fail
  loudly on the other rather than producing a half-broken result.
