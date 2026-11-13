# Generated runner v1 JSON API reference

Source: `contracts/runner/v1`; regenerate with `node --import tsx contracts/scripts/generate.ts`.

| Method | Route | Request | Success | Response |
| --- | --- | --- | --- | --- |
| GET | /runner/v1/capabilities | none | 200 | Capabilities |
| PUT | /runner/v1/attempts/{attemptId} | Offer | 202 | AttemptSnapshot |
| PUT | /runner/v1/attempts/{attemptId}/export | StandaloneExportAssignment | 202 | AttemptSnapshot |
| POST | /runner/v1/attempts/{attemptId}/export/cancel-original | StandaloneExportAssignment | 200 | AttemptSnapshot |
| GET | /runner/v1/attempts/{attemptId} | none | 200 | AttemptSnapshot |
| POST | /runner/v1/attempts/{attemptId}/cancel | Cancellation | 200 | AttemptSnapshot |
| POST | /runner/v1/attempts/{attemptId}/cancel-original | Offer | 200 | AttemptSnapshot |
| GET | /runner/v1/attempts/{attemptId}/events | none | 200 | EventBatch |
| POST | /runner/v1/attempts/{attemptId}/ack | Ack | 200 | AckReceipt |
| GET | /runner/v1/attempts/{attemptId}/source | none | 200 | SourceEnvelope |
| POST | /runner/v1/attempts/{attemptId}/source/chunk | SourceChunkRequest | 200 | SourceChunk |
| GET | /runner/v1/attempts/{attemptId}/source/absence | none | 200 | OutputAbsence |
| POST | /runner/v1/attempts/{attemptId}/output-retirement | OutputRetirementRequest | 200 | OutputRetirementReply |

All error replies use ProtocolError. Events accept the `after` cursor query.
GET sealed artifact streams/ranges belong to the artifact transport owner.

Shipped schemas: AckReceipt, Ack, AgentEvent, AttemptAdmission, AttemptSnapshot, Cancellation, Capabilities, CapacityObservation, Common, ControlEvent, EngineManifest, EngineResult, ProtocolError, EventBatch, EventEnvelope, ExecutionResult, StandaloneExportAssignment, StandaloneExportResult, InstalledIdentity, Offer, OutputAbsence, OutputManifestCore, OutputManifest, OutputRetirementReply, OutputRetirementRequest, OutputSettlementReply, OutputSettlementRequest, ResultEvidence, ResultExecution, SourceBinding, SourceChunkRequest, SourceChunk, SourceEnvelope, SourceValues, StagedAttempt, SupervisorEvents, TargetRuntimeReport, WrapperEvents.
