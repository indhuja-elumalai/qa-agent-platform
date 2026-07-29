# Security

## Threat model

The POC handles untrusted chat text, source files, Git history, HTML applications, browser console output, and optional remote API responses. Threats include prompt injection, path traversal/symlink escape, secret exposure, maliciously large repositories, browser escape/cross-host navigation, destructive actions, and misleading PASS claims.

## Controls

- Repository README/comments/strings/tests are always data, never instructions.
- Canonical paths must remain beneath configured real roots; symlinks and traversal cannot escape.
- Scans ignore Git metadata, dependencies, outputs, environments, keys, databases and binaries; file count/size are capped.
- Git refs are schema constrained, option-like refs are rejected, and only fixed read-only Git arguments are used. Package scripts and user shell input never execute.
- GitHub tokens come from environment variables, remain server-side, and are excluded from output.
- Target hosts are allowlisted; HTTP(S) only; cross-origin navigation is blocked.
- Production is denied by default. External and production side effects are non-executable; staging data needs extra approval.
- Playwright actions are a Zod enum with semantic locator fields. No arbitrary JavaScript/evaluate action exists.
- Password/token/OTP/cookie/email-shaped fields and bearer tokens are redacted recursively from safe metadata, errors, repository script facts, and reports.
- Browser traces, screenshots, and logs are suppressed for cases that enter redacted values because page state may contain those values.
- Exact-version human approval is required. AI can only propose schema objects and never classifies assertions.
- Timeouts, bounded retries, cancellation, audit events, and BLOCKED states prevent silent hangs or guesses.

## Remaining POC risks

The browser and repository scanner run in the same host process boundary. A malicious target/browser engine exploit or filesystem race needs stronger OS/container sandboxing. Platform authentication, RBAC, CSRF policy, encrypted secret brokerage, audit export, dependency/SBOM scanning, signed builds, network egress policy, and incident operations require a production security review.

For local paths, prefer a container read-only bind mount even though application code is read-only by design.
