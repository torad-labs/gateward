# Security Policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting: open the repository's
**Security** tab and choose **Report a vulnerability**. Reports go directly
to the maintainers without creating a public issue.

Please do not open public issues for suspected vulnerabilities.

## Scope

portable-hooks executes as a PreToolUse hook inside coding-agent harnesses
and vendors an engine into target projects. Reports of these classes matter
most:

- Gate bypasses: a Write/Edit/apply_patch payload shape that reaches disk
  without being judged, or that is judged against different content than
  what lands.
- Fail-open paths: any error condition that silently allows an edit in a
  project that has `.tenets/` installed (the design intent is fail-closed).
- Vendored-engine integrity: ways a target project's `.tenets/engine/` copy
  can diverge from `lock.json` without `doctor` flagging drift.

## Supported versions

Pre-1.0: only the latest release/master is supported.
