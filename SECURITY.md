# Security

> **This project is sample/educational code and is NOT intended for production use
> without additional security hardening.** It deploys real infrastructure; treat it as a
> reference implementation, not a production-ready system.

## Trust Model

- **Authentication/authorization**: AWS Cognito with OIDC/PKCE, JWT validation, and group-based
  personas. Dev-mode auth bypass is gated on `APP_ENV == "development"` and must never be enabled
  in a deployed environment.
- **Untrusted input**: The analysis engine runs tooling (`git`, ATX CLI) against externally
  submitted repositories. Repository URLs, branches, and repo-derived content (e.g. Mermaid
  diagrams) are treated as untrusted and validated/sanitized before use.
- **Secrets**: Externalized to AWS Secrets Manager and referenced by ARN. No secret values are
  committed. Example ARNs use the placeholder account `123456789012`.

## Production Considerations

The items below were raised in the security review and have been addressed. A small number of
dependency CVEs remain open because their fixes require breaking upstream upgrades — these are
called out explicitly and enforced continuously via the CI dependency scan.

1. **Third-party dependency CVEs** — frontend high-severity `xlsx` replaced with `exceljs`;
   `npm audit fix` applied; `werkzeug>=3.0.6`, `python-jose==3.4.0`, `requests==2.33.0`,
   `python-dotenv==1.2.2`, and patched `starlette` pinned. A `dependency-scan` CI job
   (`pip-audit` + `npm audit`) gates future regressions. **Remaining (upstream-blocked):**
   - `starlette` CVEs fixed only in 0.47+/1.x require a FastAPI major upgrade (current 0.115.x
     caps `starlette<0.42`).
   - `pyasn1` patched build (0.6.4) is unreachable while `python-jose` caps it at 0.4.x.
   - `ecdsa` PYSEC-2026-1325 has no fixed upstream release.
   - Frontend `react-router`/monaco-bundled `dompurify` fixes require breaking major bumps.
2. **Duplicate frontend lockfiles** — `pnpm-lock.yaml` removed; project standardizes on npm.
3. **Wildcard CORS** — `cors_origins` default changed from `"*"` to empty; per-env values set to
   the specific frontend origin (placeholder for nprd/trn/prod).
4. **IAM least privilege** — `transform-custom:*` scoped to the five execute-transformation
   actions matching the AWS managed policy `AWSTransformCustomExecuteTransformations`
   (`Resource="*"` retained; the service does not support resource-level ARNs).
5. **S3 hardening** — versioning, access logging, and public-access block enabled on asset buckets.
6. **ALB/TLS** — HTTPS listener uses `ELBSecurityPolicy-TLS13-1-2-2021-06`, HTTP→HTTPS redirect,
   and `enable_deletion_protection` (true in prod).
7. **ECS observability** — Container Insights enabled; `executeCommand` logging to a CMK-encrypted
   CloudWatch log group.
8. **PII in logs** — application logs use opaque `user_id`/`sub` instead of email; the pre-auth
   Lambda logs only trigger source, pool ID, and `sub`.
9. **ECR image tags** — `image_tag_mutability = "IMMUTABLE"`; deploy by digest.

## Reporting

Report suspected vulnerabilities to the maintainers through your internal security channel rather
than filing a public issue.
