---
description: Run one plan task end to end (task → review ∥ CI → judge → fixes → status), never merging.
argument-hint: <version> <task-number>   e.g. v1.2 1
---
Arguments as typed: $ARGUMENTS
Run the conductor loop from CLAUDE.md for plan version $0, task $1.
1. Read the plan file for $0 (mapping in .devin/skills/babelgate-task/SKILL.md), its Global Constraints, its
   Review Focus and Task $1; the spec sections it names; docs/conductor/standing-notes.md; and
   docs/conductor/notes/$0/task$1.md if it exists.
2. Check that the dependencies in the Task Index are merged; if not, say so and stop.
3. Build the task prompt: "/babelgate-task $0 $1" + standing notes + per-task notes + footer, and run it with
   scripts/conductor/devin.sh task $0 $1.
4. Follow the loop and judgment rules exactly. Keep a short running log in
   ~/babelgate-conductor/$0-task$1/conductor-log.md.
5. Finish with scripts/conductor/status-comment.sh and scripts/conductor/notify.sh, then print a summary:
   PR, verdict, CI, fix rounds used, anything the owner must look at (gates, wire-format evidence, diffs).
