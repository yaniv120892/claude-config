const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const TICKET = /[A-Z][A-Z0-9]+-\d+/

export const PR_URL = /https:\/\/github\.com\/([\w.-]+\/([\w.-]+))\/pull\/(\d+)/

// pr-review-{developer}-{ticket}-{repo}{pr}-{few words}; the ticket segment is dropped when none is found
export function sessionName({ developer, title, branch, repo, number }) {
  const ticket = (title.match(TICKET) ?? branch.match(TICKET))?.[0]
  const short = repo.replace(/^(bazak-platform-|bazak-|third-party-)/, '')
  const subject = title.split(' - ').pop().replace(/^\w+(\([^)]*\))?:\s*/, '').replace(TICKET, '')
  const words = slugify(subject).split('-').slice(0, 4).join('-')
  return ['pr-review', slugify(developer).split('-')[0], ticket && ticket.toLowerCase(), `${short}${number}`, words]
    .filter(Boolean)
    .join('-')
}
