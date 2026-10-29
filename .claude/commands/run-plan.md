---
description: Work through a range of plan tasks sequentially, pausing at gates.
argument-hint: <version> <from-task> <to-task>   e.g. v1.2 1 5
---
Arguments as typed: $ARGUMENTS
For each task N from $1 to $2 in plan $0: run /conduct $0 N. After each task, wait until the owner has merged
the PR (poll `gh pr view <PR> --json state` every 5 minutes, and run /inbox while waiting). Stop at owner
gates and escalations until "conductor: continue". Never merge yourself.
