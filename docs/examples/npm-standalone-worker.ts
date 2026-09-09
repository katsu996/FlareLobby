import { defineFlareLobby } from "@flarelobby/cloudflare";
import type { FlareLobbyBindings } from "@flarelobby/cloudflare";
import type { FlareLobbyApp } from "@flarelobby/core";

/**
 * npm 利用者向けの最小 Worker 定義です。モノレポ内部パスを参照しません。
 * 公式の導入例は `templates/standalone/src/index.ts` です。
 */
export type NpmStandaloneApp = FlareLobbyApp<
  { map: string },
  { name: string },
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  {}
>;

const lobby = defineFlareLobby<NpmStandaloneApp>({
  customRooms: {
    maxPlayers: 4,
    maxSpectators: 0,
    defaultSettings: { map: "forest" },
  },
  matchmakingPools: [
    {
      id: "solo-1v1",
      gameId: "standalone",
      seasonId: "season-1",
      mode: "duel-1v1",
      region: "jp",
      matchRoom: {
        settings: { map: "forest" },
        metadata: { name: "standalone duel" },
        teamIds: ["blue", "red"],
        maxPlayers: 2,
        minimumPlayers: 2,
        requireAllPlayersReady: false,
      },
    },
  ],
  // 初期状態はすべての保護 API を拒否します。利用者が検証済み Principal を
  // 返す認証を接続する箇所です。任意の Bearer 文字列を本人確認に使いません。
  authenticate: (request) => {
    const authorization = request.headers.get("authorization");
    if (authorization === null) {
      return null;
    }
    const subject = verifyApplicationToken(authorization);
    if (subject === null) {
      return null;
    }
    return { id: subject, playerId: subject };
  },
  // `authorization` を省略すると保護対象の操作は既定で拒否されます。
  inputLimits: {
    maxHttpRequestBytes: 16 * 1024,
    maxWebSocketMessageBytes: 8 * 1024,
    maxMessagesPerMinute: 60,
    maxRoomCreationsPerMinute: 10,
  },
  cors: {
    // 別オリジン構成ではブラウザの Origin だけを許可します。
    // 本番ではこの配列を本番 Origin に置き換えてください。
    allowedOrigins: ["http://localhost:5173"],
  },
});

/**
 * アプリケーションのトークン検証へ置き換える箇所です。
 * 配布 Worker は未接続のため常に null を返し、保護 API を拒否します。
 */
function verifyApplicationToken(_authorization: string): string | null {
  return null;
}

export default lobby.createGatewayWorker<FlareLobbyBindings>();

export {
  MatchPoolDurableObject,
  PartyDurableObject,
  PartyMembershipDurableObject,
  RateLimitDurableObject,
  RoomDurableObject,
} from "@flarelobby/cloudflare";
