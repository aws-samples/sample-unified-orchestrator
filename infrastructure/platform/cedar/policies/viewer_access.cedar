// ─────────────────────────────────────────────────────────────────
// Viewer / Restricted Persona Read-Only Policy
//
// Grants read-only access to users in PAM, PARTNERS, or viewer groups.
// These personas cannot write or manage resources.
// ─────────────────────────────────────────────────────────────────

permit (
    principal is UNO::User,
    action == UNO::Action::"read",
    resource
) when {
    principal.groups.containsAny(["AP-AWS-AMP-PAM", "AP-AWS-AMP-PARTNERS", "viewer"])
};
