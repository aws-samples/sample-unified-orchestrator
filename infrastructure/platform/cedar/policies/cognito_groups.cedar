permit (
    principal is UNO::User,
    action in [UNO::Action::"read", UNO::Action::"write", UNO::Action::"manage"],
    resource
) when {
    principal.groups.containsAny(["AP-AWS-AMP-ADMIN", "AP-AWS-AMP-PROSERVE", "AP-AWS-AMP-ATT", "admin", "MigrationAdmin", "privileged", "SuperAdmin"])
};
