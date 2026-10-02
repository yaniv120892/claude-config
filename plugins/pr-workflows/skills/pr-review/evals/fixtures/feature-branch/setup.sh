# A repo checked out on a feature branch, so "review my current branch" has
# something the skill could wrongly fall back to reviewing.
git init --quiet -b main
printf 'export const total = (items) => items.reduce((sum, item) => sum + item.price, 0);\n' > cart.js
git add -A && git commit --quiet -m "feat: cart total"
git checkout --quiet -b discount
printf 'export const total = (items, discount) => items.reduce((sum, item) => sum + item.price, 0) - discount;\n' > cart.js
git commit --quiet -am "feat: apply a discount to the cart total"
