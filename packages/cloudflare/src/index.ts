import { defineFlareLobby } from "./config.js";

export {
  FLARE_LOBBY_BINDINGS,
  FLARE_LOBBY_CONFIGURATION_ERROR_CODES,
  FlareLobbyConfigurationError,
  consumeRateLimit,
  consumeRoomCreationRateLimit,
  consumeWebSocketMessageRateLimit,
  createGatewayWorker,
  defineFlareLobby
} from "./config.js";
export {
  createCustomRoom,
  joinCustomRoom,
  leaveCustomRoom
} from "./custom-room.js";
export { listCustomRooms } from "./custom-room-list.js";
export type {
  CustomRoomConfiguration,
  DefinedFlareLobby,
  FlareLobbyBindings,
  FlareLobbyConfiguration,
  FlareLobbyConfigurationErrorCode,
  FlareLobbyGatewayWorker,
  FlareLobbyInputLimits,
  MatchmakingPoolConfiguration
} from "./config.js";
export type {
  CustomRoomCreationInput,
  CustomRoomCreationOptions,
  CustomRoomCreationResponse,
  CustomRoomCreationResult,
  CustomRoomJoinMethod,
  CustomRoomJoinInput,
  CustomRoomJoinOptions,
  CustomRoomJoinResponse,
  CustomRoomJoinResult,
  CustomRoomLeaveInput,
  CustomRoomLeaveOptions,
  CustomRoomLeaveResult,
  CustomRoomParticipantRole
} from "./custom-room.js";
export type {
  CustomRoomListQuery,
  CustomRoomListResult,
  RoomSummary
} from "./custom-room-list.js";
export type {
  CustomRoomIndexJoinMethod,
  CustomRoomIndexRecord
} from "./custom-room-index.js";
export {
  MatchPoolDurableObject,
  RateLimitDurableObject,
  RoomDurableObject
} from "./durable-objects.js";
export {
  DEFAULT_DISCONNECT_GRACE_PERIOD_MS,
  DEFAULT_EVENT_HISTORY_LIMIT,
  DEFAULT_FINISHED_ROOM_RETENTION_MS,
  DEFAULT_PROCESSED_COMMAND_RETENTION_MS,
  DEFAULT_RESUME_TOKEN_TTL_MS,
  getParticipantWebSocketTag,
  getPrincipalWebSocketTag,
  getResumeWebSocketTag,
  getRoleWebSocketTag,
  getRoomWebSocketTag
} from "./room.js";
export {
  DEFAULT_MATCHMAKING_TICKET_TTL_MS,
  MATCHMAKING_POOL_KEY_SEPARATOR,
  createMatchmakingPoolKey,
  createMatchPoolKey,
  getMatchmakingPoolKey,
  getMatchPoolName
} from "./match-pool.js";
export type {
  MatchmakingPoolKeyInput,
  MatchPoolInitializationOptions,
  MatchPoolSnapshot,
  MatchmakingAttributeObject,
  MatchmakingMatchRoomRecord,
  MatchmakingMatchResult,
  MatchmakingTicketCancellationOptions,
  MatchmakingTicketCreationOptions,
  MatchmakingTicketEvent,
  MatchmakingTicketEventQueryOptions,
  MatchmakingTicketMatchOptions,
  MatchmakingTicketRecord,
  MatchmakingTicketReservationOptions
} from "./match-pool.js";
export type {
  RoomInitializationOptions,
  RoomStartConditions,
  RoomProcessedCommand,
  RoomProcessedCommandOptions,
  RoomScheduledOperation,
  RoomScheduledOperationKind,
  RoomScheduledOperationOptions,
  RoomStateTransitionOptions,
  RoomJoinMethod,
  RoomParticipantRole,
  RoomParticipantJoinOptions,
  RoomParticipantJoinResult,
  RoomParticipantLeaveOptions,
  RoomParticipantLeaveResult,
  RoomParticipantDisconnectOptions,
  RoomParticipantOperationOptions,
  RoomSetReadyOptions,
  RoomSelectTeamOptions,
  RoomHostOperationOptions,
  RoomUpdateSettingsOptions,
  RoomTransferHostOptions,
  RoomKickOptions,
  RoomStartMatchOptions,
  RoomCloseOptions,
  RoomOperationResult,
  RoomJoinOptions,
  RoomJoinResult,
  RoomLeaveOptions,
  RoomLeaveResult,
  RoomResumeHandshake,
  RoomWebSocketAttachment
} from "./room.js";
export {
  FLARE_LOBBY_RATE_LIMIT_SCOPES,
  FLARE_LOBBY_WEBSOCKET_AUTH_PROTOCOL_PREFIX,
  FLARE_LOBBY_WEBSOCKET_PROTOCOL,
  authenticateGatewayRequest,
  authenticateRequest,
  authorizeGatewayOperation,
  createErrorResponse,
  createGatewayPrincipalEnvelope,
  issueJoinToken,
  issueResumeToken,
  normalizePrincipal,
  readValidatedJsonBody,
  readWebSocketJoinToken,
  validateQuery,
  validateWebSocketCommand,
  verifyGatewayPrincipalEnvelope,
  verifyJoinToken,
  verifyResumeToken,
  verifyWebSocketJoinToken,
  verifyWebSocketResumeToken,
  verifyWebSocketRoomToken
} from "./security.js";
export type {
  AuthenticatedGatewayRequest,
  FlareLobbyAuthenticationHook,
  FlareLobbyAuthenticationResult,
  FlareLobbyAuthorizationContext,
  FlareLobbyAuthorizationHook,
  FlareLobbyAuthorizationHooks,
  FlareLobbyAuthorizationOperation,
  FlareLobbyAuthorizationRequest,
  FlareLobbyInputValidator,
  FlareLobbyRateLimitDecision,
  FlareLobbyRateLimitScope,
  FlareLobbyRoomTokenClaims,
  FlareLobbyRoomParticipantRole,
  FlareLobbyRoomTokenIssueOptions,
  FlareLobbyRoomTokenPurpose,
  FlareLobbyRoomTokenVerificationOptions,
  FlareLobbyWebSocketJoinTokenVerificationOptions,
  FlareLobbyWebSocketRoomTokenVerificationOptions,
  GatewayPrincipalEnvelope
} from "./security.js";

/**
 * リポジトリの Miniflare 検証に使う最小構成です。
 *
 * 実際の利用者は独自の Worker エントリーポイントで `defineFlareLobby()` を呼び、
 * `wrangler types` が生成した `Env` を `createGatewayWorker<Env>()` に渡します。
 */
const developmentLobby = defineFlareLobby({
  customRooms: {
    maxPlayers: 4,
    defaultSettings: {}
  },
  matchmakingPools: [],
  authenticate: () => null,
  inputLimits: {
    maxHttpRequestBytes: 16 * 1024,
    maxWebSocketMessageBytes: 8 * 1024,
    maxMessagesPerMinute: 60,
    maxRoomCreationsPerMinute: 10
  }
});

export default developmentLobby.createGatewayWorker<Env>();
