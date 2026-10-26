---
description: Process owner commands ("conductor: …") on open PRs.
---
For every open PR: read comments newer than the last processed one (track it in
~/llm-proxy-conductor/inbox-state.json). For each comment by the repo owner starting with "conductor:",
execute the command as defined in CLAUDE.md (fix / rerun review / continue / hold / next). Reply on the PR
with a one-line acknowledgement ("conductor: starting fix round 2"), then do it. Summarize what you did.
