# Deployment packaging

No resources are deployed by this repository.

## Local

Run web on port 3000 and demo on 3100. Compose binds both ports to loopback by
default. `/api/health` is a liveness endpoint; `/api/readiness` verifies
database access. Persist `QA_DATA_DIR`.

## Docker Compose

```bash
docker compose build
docker compose up
```

Services run as the non-root Playwright image user. `qa-data` is mounted at `/app/var`. Repository sources must be separately mounted read-only and their container parent added to `QA_ALLOWED_REPOSITORY_ROOTS`.

## Network requirements

Inbound:

- TCP 3000 for the internal web interface
- TCP 3100 only for the included demo (not required for a real target)

Do not remove the loopback binding without adding network access controls and
platform authentication.

Outbound:

- Target local/test/staging application
- npm registry during build
- GitHub API only when enabled
- Optional AI provider API only after a provider adapter is reviewed and enabled

## Secrets and volumes

Inject `GITHUB_TOKEN`, future AI keys, and auth state through the runtime secret mechanism. Do not bake them into images or Compose files. Persist database, evidence, reports and browser artifacts in `qa-data`; back them up according to internal retention policy.

## Browser limitations

Playwright requires compatible browser binaries and OS libraries. The Dockerfile uses the matching Playwright base image. Browser execution needs adequate shared memory, CPU, and writable temporary storage.

## Graceful shutdown

Docker sends `SIGTERM`; Next.js stops accepting requests. In-process jobs do not resume after a crash. Persisted runs remain visible and should be marked failed/cancelled by a future recovery worker.

## Future EC2 considerations

A later infrastructure review must decide private subnet/load balancer access, IAM/secret injection, read-only repository delivery, encrypted persistent volume, outbound firewall policy, patching, monitoring, log retention, backup/restore, concurrency limits, and browser sandboxing. This project creates none of those resources.
