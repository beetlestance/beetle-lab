const environmentName = 'beetle-release';
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Release policy object required');
  return value as Record<string, unknown>;
}
function entries(value: unknown, maximum: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > maximum) throw Error('Release policy list bound');
  return value.map(record);
}
/** GitHub applies the actual review gate; this refuses absent/implicitly created policy. */
export function captureReleaseAuthority(environment: unknown, branches: unknown): void {
  const policy = record(environment);
  if (policy.name !== environmentName) throw Error('Release environment mismatch');
  requireReviews(policy.protection_rules);
  requireBranch(policy.deployment_branch_policy, branches);
}
function requireReviews(input: unknown): void {
  const reviews = entries(input, 6).filter((rule) => rule.type === 'required_reviewers');
  if (reviews.length !== 1) throw Error('Release approval required');
  const reviewers = entries(reviews[0]!.reviewers, 6);
  if (!reviewers.length || !reviewers.every(validReviewer)) throw Error('Release reviewers required');
}
function requireBranch(input: unknown, branches: unknown): void {
  const branchPolicy = record(input);
  if (branchPolicy.protected_branches !== false || branchPolicy.custom_branch_policies !== true) {
    throw Error('Explicit release branch policy required');
  }
  const page = record(branches);
  const rules = entries(page.branch_policies, 100);
  if (
    page.total_count !== 1 ||
    rules.length !== 1 ||
    rules[0]!.name !== 'rewrite/integration' ||
    rules[0]!.type !== 'branch'
  ) {
    throw Error('Exact release branch required');
  }
}
function validReviewer(value: Record<string, unknown>): boolean {
  const id = record(value.reviewer).id;
  return (
    (value.type === 'User' || value.type === 'Team') && typeof id === 'number' && Number.isSafeInteger(id) && id > 0
  );
}
