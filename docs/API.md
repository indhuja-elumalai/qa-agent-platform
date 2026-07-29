# Internal API

All JSON input is schema validated. Success responses use `{ "data": ... }`; errors use `{ "error": "...", "validation": ... }`.

| Method | Path                                             | Purpose                            |
| ------ | ------------------------------------------------ | ---------------------------------- |
| POST   | `/api/internal/requests`                         | Create a QA request                |
| POST   | `/api/internal/requests/:id/scan`                | Queue repository scan and planning |
| GET    | `/api/internal/requests/:id`                     | Request, scan, plan and progress   |
| POST   | `/api/internal/requests/:id/plan`                | Create/regenerate rule-based plan  |
| GET    | `/api/internal/plans/:id`                        | Get latest plan version            |
| PATCH  | `/api/internal/plans/:id/items/:testId`          | Edit case and invalidate approval  |
| POST   | `/api/internal/plans/:id/items/:testId/decision` | Approve/reject individual case     |
| POST   | `/api/internal/plans/:id/approve`                | Approve exact plan version         |
| POST   | `/api/internal/plans/:id/run`                    | Queue approved plan                |
| GET    | `/api/internal/runs/:id`                         | Run status/results                 |
| GET    | `/api/internal/runs/:id/events`                  | Structured progress events         |
| POST   | `/api/internal/runs/:id/cancel`                  | Request safe cancellation          |
| POST   | `/api/internal/runs/:id/rerun`                   | Rerun `FULL` or `FAILURES`         |
| GET    | `/api/internal/runs`                             | List history                       |
| GET    | `/api/internal/runs/:id/report`                  | JSON report                        |
| GET    | `/api/health`                                    | Liveness                           |
| GET    | `/api/readiness`                                 | Database readiness                 |

Sensitive local paths are not needed by the normal browser workflow. Artifact paths exist in machine reports for local operators; a production gateway should replace them with authorised opaque download IDs.
