At the very end of your output print exactly one line `PR_URL: <url>`. If a stop rule applies (a fixture or
contract test you can't satisfy without changing expected values; a missing dependency; a provider-pair
special case the canonical format can't express; an ambiguity you must not resolve yourself), do not
improvise: print a line starting with `STOP:` explaining why, and end. Show `git diff --stat` of your final
commit before the PR_URL line.
