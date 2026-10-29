# babelgate README demo: Claude Code fixes a failing test through babelgate,
# on a free OpenRouter model. Run with scripts/demo/record-demo.sh.
Output "/tmp/babelgate-demo.gif"
Set Shell "bash"
Set FontSize 16
Set Width 1200
Set Height 700
Set Theme "Catppuccin Mocha"
Set TypingSpeed 30ms

# Off camera: key, quiet logs, warm the npx cache (no "Ok to install?" prompt).
Hide
Type "cd /tmp/babelgate-demo && export PS1='$ ' OPENAI_API_KEY=$OPENROUTER_API_KEY LOG_LEVEL=warn CLAUDE_CODE_MAX_OUTPUT_TOKENS=8000 && unset ANTHROPIC_API_KEY && npx -y babelgate --help >/dev/null && clear" Enter
Wait /^\$ ?$/
Show

# 1. Start babelgate in front of OpenRouter.
#    Its logs go to a file so they can't scribble over Claude Code's screen.
Type "npx babelgate --preset claude-code --target openai --model poolside/laguna-s-2.1:free --base-url https://openrouter.ai/api > /tmp/babelgate.log 2>&1 &" Enter
Sleep 4s
Type "grep ^export /tmp/babelgate.log" Enter
Wait+Screen@60s /ANTHROPIC_AUTH_TOKEN/
Sleep 2s

# 2. Paste the two lines it printed.
Type "export ANTHROPIC_BASE_URL=http://localhost:3000 ANTHROPIC_AUTH_TOKEN=babelgate" Enter
Type "clear" Enter

# 3. The bug, then Claude Code (print mode, like the release gate: no dialogs) fixes it.
Type "cat src/sum.js" Enter
Sleep 2s
Type `claude -p "Make the failing test pass." --permission-mode acceptEdits --allowedTools "Bash(npm test:*)" 2>/dev/null` Enter
# Cut the model's thinking time: 2s on camera, then skip to the answer.
Sleep 2s
Hide
Wait@240s /^\$ ?$/
Show
Sleep 3s

# 4. Proof.
Type "cat src/sum.js && npm test 2>&1 | grep -E '(pass|fail) [0-9]'" Enter
Sleep 5s
