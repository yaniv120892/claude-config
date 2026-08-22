#!/bin/sh
input=$(cat)
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd')
dir=$(basename "$cwd")

# Location: repo name, plus the worktree/subdir name when it differs
git_common=$(git -C "$cwd" --no-optional-locks rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
if [ -n "$git_common" ]; then
  repo=$(basename "$(dirname "$git_common")")
else
  repo=""
fi
if [ -n "$repo" ] && [ "$repo" != "$dir" ]; then
  loc_info=$(printf "\033[0;36m%s\033[0;90m/\033[1;36m%s\033[0m" "$repo" "$dir")
else
  loc_info=$(printf "\033[0;36m%s\033[0m" "$dir")
fi

# Git info
git_branch=$(git -C "$cwd" --no-optional-locks branch --show-current 2>/dev/null)
if [ -n "$git_branch" ]; then
  git_dirty=$(git -C "$cwd" --no-optional-locks status --porcelain 2>/dev/null)
  if [ -n "$git_dirty" ]; then
    git_info=$(printf " \033[1;34mgit:(\033[0;31m%s\033[1;34m) \033[0;33m✗\033[0m" "$git_branch")
  else
    git_info=$(printf " \033[1;34mgit:(\033[0;31m%s\033[1;34m)\033[0m" "$git_branch")
  fi
else
  git_info=""
fi

# Model info
model=$(echo "$input" | jq -r '.model.display_name // empty')
if [ -n "$model" ]; then
  model_info=$(printf " \033[0;35m[%s]\033[0m" "$model")
else
  model_info=""
fi

# Context used percentage
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
if [ -n "$used" ]; then
  used_int=$(printf "%.0f" "$used")
  if [ "$used_int" -ge 75 ]; then
    ctx_color="\033[0;31m"
  elif [ "$used_int" -ge 50 ]; then
    ctx_color="\033[0;33m"
  else
    ctx_color="\033[0;32m"
  fi
  ctx_info=$(printf " ${ctx_color}ctx:%s%%\033[0m" "$used_int")
else
  ctx_info=""
fi

printf "\033[1;32m➜\033[0m  %s%s%s%s" "$loc_info" "$git_info" "$model_info" "$ctx_info"
