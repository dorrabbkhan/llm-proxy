# Source this to act as the babelgate-conductor GitHub App (bash).
# - gh: the wrapper in bin/ goes first on PATH (fresh token per call).
# - git: github.com SSH remotes are rewritten to HTTPS and authenticated
#   by bin/git-credential-babelgate; commits are authored by the bot.
# Used by devin.sh, as-app.sh and start.sh. Your own shell is unaffected.
_conductor_bin="$(cd "$(dirname "${BASH_SOURCE[0]}")/bin" && pwd)"
export PATH="$_conductor_bin:$PATH"
export GIT_CONFIG_COUNT=3
export GIT_CONFIG_KEY_0="url.https://github.com/.insteadOf" GIT_CONFIG_VALUE_0="git@github.com:"
export GIT_CONFIG_KEY_1="credential.https://github.com.helper" GIT_CONFIG_VALUE_1=""
export GIT_CONFIG_KEY_2="credential.https://github.com.helper" GIT_CONFIG_VALUE_2="$_conductor_bin/git-credential-babelgate"
export GIT_AUTHOR_NAME="babelgate-conductor[bot]" GIT_COMMITTER_NAME="babelgate-conductor[bot]"
export GIT_AUTHOR_EMAIL="349243292+babelgate-conductor[bot]@users.noreply.github.com"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
export CONDUCTOR_ACTOR="babelgate-conductor[bot]"
unset _conductor_bin
