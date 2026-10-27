# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |
| < 1.0   | No        |

## Reporting a vulnerability

Please report vulnerabilities **privately** through GitHub: open the
repository's **Security** tab and use **"Report a vulnerability"** (private
vulnerability reporting). Do not open a public issue for a security problem.

Include, where you can:

- the affected version and configuration (`SOURCE_API`/`TARGET_API`),
- steps to reproduce, and
- the impact you believe the issue has.

Never include API keys — yours or anyone else's — in a report.

You can expect an acknowledgement within a few days. If the report is
accepted, a fix will be prepared privately and released before details are
made public.

## Security notes for self-hosters

- `babelgate` forwards upstream provider keys stored in its environment —
  treat `.env` and any process dump as secret material.
- Client access is gated by `PROXY_API_KEY` when set; without it the proxy is
  open — run it only on trusted networks.
- The proxy never logs prompt bodies, completions, or keys. If you find a
  path where one leaks into logs or error messages, that is a bug — report
  it privately as above.
