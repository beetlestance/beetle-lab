export function publicationCredentials() {
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.GITHUB_REPOSITORY !== 'beetlestance/beetle-lab' ||
    process.env.GITHUB_REF !== 'refs/heads/rewrite/integration' ||
    process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
  )
    throw Error('Explicit manual repository CI publication required');
  const actor = process.env.GITHUB_ACTOR;
  const token = process.env.GH_TOKEN;
  if (!actor || !token) throw Error('Explicit CI publication credentials required');
  return { actor, token };
}
