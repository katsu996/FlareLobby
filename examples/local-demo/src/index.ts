import { defineFlareLobby } from "@flarelobby/cloudflare";
import type { FlareLobbyBindings } from "@flarelobby/cloudflare";
import type { FlareLobbyApp } from "@flarelobby/core";

type DemoApp = FlareLobbyApp<
  { map: "forest" | "desert" },
  { name: string; playlist: string },
  { chat: { text: string } }
>;

function readDemoPlayer(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/u)?.[1];
  const value = request.headers.get("x-demo-player") ?? bearer;

  return value !== undefined && /^[a-z][a-z0-9_-]{0,31}$/u.test(value)
    ? value
    : null;
}

const lobby = defineFlareLobby<DemoApp>({
  customRooms: {
    maxPlayers: 4,
    maxSpectators: 2,
    defaultSettings: { map: "forest" }
  },
  matchmakingPools: [
    {
      id: "ranked-jp",
      gameId: "local-demo",
      seasonId: "season-1",
      mode: "ranked-1v1",
      region: "jp",
      matchRoom: {
        settings: { map: "forest" },
        metadata: { name: "ローカル対戦", playlist: "ranked" },
        teamIds: ["blue", "red"],
        maxPlayers: 2,
        minimumPlayers: 2,
        requireAllPlayersReady: false
      },
      rating: { initialRating: 1_500, kFactor: 24 }
    }
  ],
  // この認証はローカル確認専用。本番へ持ち込まず、実際の認証サービスへ置き換える。
  authenticate: (request) => {
    const player = readDemoPlayer(request);
    return player === null
      ? null
      : { id: `demo:${player}`, playerId: `demo:${player}` };
  },
  // Room Durable Object が実際のホスト・役割を再検証するため、ローカルでは入口を開ける。
  authorization: {
    authorizeJoin: () => true,
    authorizeSpectate: () => true,
    authorizeHostOperation: () => true,
    authorizeMatchResult: () => true
  },
  inputLimits: {
    maxHttpRequestBytes: 16 * 1024,
    maxWebSocketMessageBytes: 8 * 1024,
    maxMessagesPerMinute: 60,
    maxRoomCreationsPerMinute: 10
  }
});

export default lobby.createGatewayWorker<FlareLobbyBindings>();
export {
  MatchPoolDurableObject,
  RateLimitDurableObject,
  RoomDurableObject
} from "@flarelobby/cloudflare";
