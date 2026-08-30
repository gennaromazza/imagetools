export const PARTY_FRAME_API_CONTRACT = "partyframe-api-v1";

export interface PartyFrameApiHealth {
  status: "ok";
  apiContract: typeof PARTY_FRAME_API_CONTRACT;
  instanceId: string;
  startedAt: string;
  timestamp: string;
}

export function isCompatiblePartyFrameApiHealth(value: unknown): value is PartyFrameApiHealth {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PartyFrameApiHealth>;
  return candidate.status === "ok"
    && candidate.apiContract === PARTY_FRAME_API_CONTRACT
    && typeof candidate.instanceId === "string"
    && candidate.instanceId.length > 0
    && candidate.instanceId.length <= 128
    && typeof candidate.startedAt === "string"
    && candidate.startedAt.length > 0
    && candidate.startedAt.length <= 64
    && typeof candidate.timestamp === "string"
    && candidate.timestamp.length > 0
    && candidate.timestamp.length <= 64;
}
