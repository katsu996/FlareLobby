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
export {
  MatchPoolDurableObject,
  RateLimitDurableObject,
  RoomDurableObject
} from "./durable-objects.js";
export {
  FLARE_LOBBY_RATE_LIMIT_SCOPES,
  authenticateGatewayRequest,
  authenticateRequest,
  authorizeGatewayOperation,
  createErrorResponse,
  createGatewayPrincipalEnvelope,
  issueJoinToken,
  issueResumeToken,
  normalizePrincipal,
  readValidatedJsonBody,
  validateQuery,
  validateWebSocketCommand,
  verifyGatewayPrincipalEnvelope,
  verifyJoinToken,
  verifyResumeToken
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
  FlareLobbyRoomTokenIssueOptions,
  FlareLobbyRoomTokenPurpose,
  FlareLobbyRoomTokenVerificationOptions,
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
