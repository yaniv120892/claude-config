import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessionName, PR_URL } from './name.mjs'

test('house PR title with key and repo segments', () => {
  assert.equal(
    sessionName({ developer: 'Dana Levi', title: 'RDBAZ-1526 - dal - back office shows business contacts and images', branch: 'x', repo: 'bazak-platform-dal', number: '812' }),
    'pr-review-dana-rdbaz-1526-dal812-back-office-shows-business',
  )
})

test('ticket falls back to the branch, then is omitted', () => {
  const base = { developer: 'Sam', title: 'fix(auth): refresh tokens early', repo: 'third-party-gw-api', number: '7' }
  assert.equal(sessionName({ ...base, branch: 'sam/RDAUT-9-refresh' }), 'pr-review-sam-rdaut-9-gw-api7-refresh-tokens-early')
  assert.equal(sessionName({ ...base, branch: 'main-fix' }), 'pr-review-sam-gw-api7-refresh-tokens-early')
})

test('PR_URL reads a Slack-wrapped link and ignores issues', () => {
  assert.equal('<https://github.com/bazakai/bazak-mastra/pull/42|PR>'.match(PR_URL)[3], '42')
  assert.equal('https://github.com/bazakai/bazak-mastra/issues/42'.match(PR_URL), null)
})
