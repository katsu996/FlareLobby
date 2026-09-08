import { defineFlareLobby } from "@flarelobby/cloudflare";
import type { FlareLobbyBindings } from "@flarelobby/cloudflare";
import type { FlareLobbyApp } from "@flarelobby/core";

/**
 * 最小導入テンプレートのアプリケーション定義です。
 * ゲーム固有の設定・メタデータはここを拡張してください。
 */
export type StandaloneApp = FlareLobbyApp<
  { map: string },
  { name: string },
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  {}
>;

const lobby = defineFlareLobby<StandaloneApp>({
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
  // 初期状態はすべての保護 API を拒否します。
  // 利用者が検証済み Principal を返す認証を接続する箇所:
  // `verifyApplicationToken()` を実際の認証サービスによる検証へ置き換え、
  // 検証済みの主体だけ `{ id, playerId }` として返してください。
  // 任意の Bearer 文字列を本人確認に使う実装をここへ含めないでください。
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
  // 参加・観戦・ホスト操作を許可する場合は、ここに明示的な Hook を追加してください。
  inputLimits: {
    maxHttpRequestBytes: 16 * 1024,
    maxWebSocketMessageBytes: 8 * 1024,
    maxMessagesPerMinute: 60,
    maxRoomCreationsPerMinute: 10,
  },
  cors: {
    // ローカルのブラウザ開発 Origin だけを許可します。
    // 本番の許可 Origin へ変更する箇所: この配列を本番 Origin に置き換えてください。
    allowedOrigins: ["http://localhost:5173"],
  },
});

/**
 * アプリケーションのトークン検証へ置き換える箇所です。
 * テンプレートの配布 Worker は未接続のため常に null を返し、保護 API を拒否します。
 * テスト用認証は E2E harness の差し替え entry でのみ注入し、
 * 配布 Worker に認証バイパスフラグを実装しないでください。
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
