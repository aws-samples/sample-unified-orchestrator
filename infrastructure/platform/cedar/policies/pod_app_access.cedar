// ─────────────────────────────────────────────────────────────────
// POD-Scoped Application Access Policy
//
// Permits read and write actions on UNO::Application resources
// when the requested application_id is in the user's accessible_apps
// set (derived from their POD assignment via DynamoDB).
//
// This policy enforces Layer 3 (POD-scoped) authorization.
// The accessible_apps and application_id are passed in the Cedar
// context by require_app_access in haf-uno-auth.
// ─────────────────────────────────────────────────────────────────

permit (
    principal,
    action in [UNO::Action::"read", UNO::Action::"write"],
    resource is UNO::Application
) when {
    context.accessible_apps.contains(context.application_id)
};
