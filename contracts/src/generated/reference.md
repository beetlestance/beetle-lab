# Generated runner v1 JSON API reference

Source: `contracts/runner/v1`; regenerate with `node --import tsx contracts/scripts/generate.ts`.

| Method | Route | Request | Success | Response |
| --- | --- | --- | --- | --- |
| GET | /runner/v1/capabilities | none | 200 | Capabilities |
| PUT | /runner/v1/attempts/{attemptId} | Offer | 202 | AttemptSnapshot |
| GET | /runner/v1/attempts/{attemptId} | none | 200 | AttemptSnapshot |
| POST | /runner/v1/attempts/{attemptId}/cancel | Cancellation | 200 | AttemptSnapshot |
| POST | /runner/v1/attempts/{attemptId}/cancel-original | Offer | 200 | AttemptSnapshot |
| GET | /runner/v1/attempts/{attemptId}/events | none | 200 | EventBatch |
| POST | /runner/v1/attempts/{attemptId}/ack | Ack | 200 | AckReceipt |

All error replies use ProtocolError. Events accept the `after` cursor query.
GET sealed artifact streams/ranges belong to the artifact transport owner.

Shipped schemas: AckReceipt, Ack, AgentEvent, AttemptAdmission, AttemptSnapshot, Cancellation, Capabilities, CapacityObservation, Common, ControlEvent, EngineManifest, EngineResult, ProtocolError, EventBatch, EventEnvelope, InstalledIdentity, Offer, ResultEvidence, ResultExecution, StagedAttempt, SupervisorEvents, WrapperEvents.
