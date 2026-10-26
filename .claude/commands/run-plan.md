---
description: Work through a range of plan tasks sequentially, pausing at gates.
argument-hint: <version> <from-task> <to-task>
---
For each task N from $2 to $3 in plan $1: run /conduct $1 N. After each task, wait until the owner has merged
the PR (poll `gh pr view <PR> --json state` every 5 minutes, and run /inbox while waiting). Stop at owner
gates and escalations until "conductor: continue". Never merge yourself.
