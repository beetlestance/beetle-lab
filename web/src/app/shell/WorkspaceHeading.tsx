/** The workspace title above its section tabs, the same on every section that has no own header. */
export function WorkspaceHeading({ name }: { name: string }) {
  return (
    <header className="workspace-heading">
      <p className="workspace-heading-eyebrow">Workspaces</p>
      <h1>{name}</h1>
    </header>
  );
}
