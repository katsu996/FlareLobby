/**
 * 公開デモの Gateway 設定です。
 *
 * Worker entry（`src/index.ts`）とテストが同じ設定を参照します。
 * local-demo のローカル専用認証は import しません。
 */
import { defineFlareLobby } from "@flarelobby/cloudflare";
import type { FlareLobbyApp } from "@flarelobby/core";
import { authenticateHostedDemoRequest } from "./auth.js";
import { HOSTED_RANKED_POOL_ID } from "./rps.js";

export type HostedDemoApp = FlareLobbyApp<
  { map: "forest" | "desert" },
  { name: string; playlist: string },
  { chat: { text: string } }
>;

/** 公開デモの Gateway を構築します。認証は Supabase JWT 検証だけです。 */
export function createHostedDemoGateway(supabaseUrl: string) {
  return defineFlareLobby<HostedDemoApp>({
    customRooms: {
      maxPlayers: 4,
      maxSpectators: 2,
      defaultSettings: { map: "forest" },
    },
    matchmakingPools: [
      {
        id: HOSTED_RANKED_POOL_ID,
        gameId: "hosted-demo",
        seasonId: "season-1",
        mode: "ranked-1v1",
        region: "jp",
        matchRoom: {
          settings: { map: "forest" },
          metadata: { name: "公開対戦", playlist: "ranked" },
          teamIds: ["blue", "red"],
          maxPlayers: 2,
          minimumPlayers: 2,
          requireAllPlayersReady: false,
        },
        rating: { initialRating: 1_500, kFactor: 24 },
      },
    ],
    // Supabase JWT 検証だけを使う。任意 Bearer や x-demo-player は拒否する。
    authenticate: (request) =>
      authenticateHostedDemoRequest(request, supabaseUrl),
    // Room Durable Object が実際のホスト・役割を再検証するため、入口は
    // 認証済み利用者に開ける。試合結果の直送は一般利用者に開放しない。
    authorization: {
      authorizeJoin: () => true,
      authorizeSpectate: () => true,
      authorizeHostOperation: () => true,
      authorizeMatchResult: () => false,
    },
    inputLimits: {
      maxHttpRequestBytes: 16 * 1024,
      maxWebSocketMessageBytes: 8 * 1024,
      maxMessagesPerMinute: 60,
      maxRoomCreationsPerMinute: 3,
    },
  });
}
