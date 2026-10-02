# A project with no issue tracker: a pushed branch carrying one bug fix, and a
# local bare repo standing in for the remote so fetch and push work offline.
git init --quiet --bare .origin.git
git init --quiet -b main
git remote add origin "$PWD/.origin.git"
printf '.origin.git/\n' > .gitignore
printf 'export const avatarUrl = (user) => user.avatar.url;\n' > avatar.js
git add -A && git commit --quiet -m "feat: avatar url helper"
git push --quiet -u origin main
git checkout --quiet -b fix-missing-avatar
printf 'export const avatarUrl = (user) => user.avatar?.url ?? "/default-avatar.png";\n' > avatar.js
git commit --quiet -am "fix: fall back to the default avatar when a user has none"
git push --quiet -u origin fix-missing-avatar
