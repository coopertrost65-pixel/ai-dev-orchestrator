interface ClaudePermissionDecision {
  action: string;
  status: string;
}

interface ClaudePermissionContext {
  permissionDecisions?: ClaudePermissionDecision[];
}

function hasApprovedPermission(request: ClaudePermissionContext, action: string): boolean {
  return Boolean(request.permissionDecisions?.some((item) => item.action === action && item.status === "approved"));
}

export function claudeDisallowedTools(request: ClaudePermissionContext): string[] {
  const rules = [
    "Bash(rm *)",
    "Bash(unlink *)",
    "Bash(rmdir *)",
    "Bash(npm install *)",
    "Bash(npm uninstall *)",
    "Bash(pnpm add *)",
    "Bash(pnpm remove *)",
    "Bash(yarn add *)",
    "Bash(yarn remove *)",
    "Bash(git commit *)",
    "Bash(git push *)",
    "Bash(git branch *)",
    "Bash(git checkout -b *)",
    "Bash(npx prisma migrate *)",
    "Bash(npx drizzle-kit migrate *)",
    "Bash(wrangler deploy *)",
    "Bash(vercel *)",
    "Bash(firebase deploy *)",
  ];

  return rules.filter((rule) => {
    if ((rule.includes("npm ") || rule.includes("pnpm ") || rule.includes("yarn ")) && hasApprovedPermission(request, "install_packages")) return false;
    if ((rule.includes("rm ") || rule.includes("unlink ") || rule.includes("rmdir ")) && hasApprovedPermission(request, "delete_files")) return false;
    if (rule.includes("git ") && hasApprovedPermission(request, "git_write")) return false;
    if (rule.includes("migrate") && hasApprovedPermission(request, "database_migration")) return false;
    if ((rule.includes("deploy") || rule.includes("vercel")) && hasApprovedPermission(request, "production_deploy")) return false;
    return true;
  });
}
