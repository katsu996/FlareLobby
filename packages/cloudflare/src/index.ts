import { defineFlareLobby } from "./config.js";

export {
  FLARE_LOBBY_BINDINGS,
  FLARE_LOBBY_CONFIGURATION_ERROR_CODES,
  FlareLobbyConfigurationError,
  createGatewayWorker,
  defineFlareLobby
} from "./config.js";
export type {
  CustomRoomConfiguration,
  DefinedFlareLobby,
  FlareLobbyAuthenticationHook,
  FlareLobbyBindings,
  FlareLobbyConfiguration,
  FlareLobbyConfigurationErrorCode,
  FlareLobbyGatewayWorker,
  FlareLobbyInputLimits,
  MatchmakingPoolConfiguration
} from "./config.js";
export {
  MatchPoolDurableObject,
  RoomDurableObject
} from "./durable-objects.js";

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
    maxMessagesPerMinute: 60
  }
});

export default developmentLobby.createGatewayWorker<Env>();
