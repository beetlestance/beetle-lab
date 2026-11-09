export class AgentConfigurationError extends Error {
  constructor() { super('Agent configuration rejected'); this.name = 'AgentConfigurationError'; }
}
