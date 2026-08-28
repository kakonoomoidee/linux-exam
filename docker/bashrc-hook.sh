#!/bin/bash
# Sourced automatically on login (/etc/profile.d). Logs every command the
# student runs back to the exam server via PROMPT_COMMAND, so grading can
# happen live even for read-only commands like `cat` that leave no filesystem
# trace. SESSION_TOKEN and CMD_LOG_CALLBACK_URL are injected as container env
# vars by containerDrivers.js at creation time.

__tekser_log_cmd() {
  local exit_code=$?
  local cmd
  cmd=$(HISTTIMEFORMAT= history 1 | sed -E 's/^[[:space:]]*[0-9]+[[:space:]]*//')

  # avoid logging empty lines (e.g. just pressing Enter)
  [ -z "$cmd" ] && return

  # basic JSON string escaping — sufficient for typical shell commands
  local escaped_cmd
  escaped_cmd="\"$(printf '%s' "$cmd" | sed 's/\\/\\\\/g; s/"/\\"/g')\""

  curl -s -m 2 -X POST "$CMD_LOG_CALLBACK_URL" \
    -H "Content-Type: application/json" \
    -d "{\"session_token\":\"$SESSION_TOKEN\",\"cmd\":$escaped_cmd,\"exit_code\":$exit_code}" \
    >/dev/null 2>&1 &
  disown $! 2>/dev/null   # drop from job table so bash doesn't print "[1]+ Done ..."
}

export HISTCONTROL=ignoredups
export PROMPT_COMMAND="__tekser_log_cmd"
