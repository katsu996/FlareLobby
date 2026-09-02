import { defineFlareLobby } from "./config.js";
export {
  MatchPoolDurableObject,
  PartyDurableObject,
  PartyMembershipDurableObject,
  RateLimitDurableObject,
  RoomDurableObject,
  type IRoomDurableObject,
} from "./durable-objects.js";
/**
 * リポジトリの Miniflare 検証に使う最小構成です。
 *
 * 実際の利用者は独自の Worker エントリーポイントで `defineFlareLobby()` を呼び、
 * `wrangler types` が生成した `Env` を `createGatewayWorker<Env>()` に渡します。
 * 公開パッケージのエントリーポイントは `src/index.ts` のままです。
 */
const developmentLobby = defineFlareLobby({
  customRooms: {
    maxPlayers: 4,
    defaultSettings: {},
  },
  matchmakingPools: [],
  authenticate: () => null,
  inputLimits: {
    maxHttpRequestBytes: 16 * 1024,
    maxWebSocketMessageBytes: 8 * 1024,
    maxMessagesPerMinute: 60,
    maxRoomCreationsPerMinute: 10,
  },
});

export default developmentLobby.createGatewayWorker<Env>();
