import { defineFlareLobby } from "@flarelobby/cloudflare";
import type { FlareLobbyBindings } from "@flarelobby/cloudflare";
import type { FlareLobbyApp } from "@flarelobby/core";
import { authenticateSupabaseRequest } from "./auth.js";

export type SupabaseApp = FlareLobbyApp<
  { map: string },
  { name: string },
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  {}
>;

type SupabaseWorkerEnv = FlareLobbyBindings & {
  readonly SUPABASE_URL: string;
};

function createSupabaseWorker(supabaseUrl: string) {
  const lobby = defineFlareLobby<SupabaseApp>({
    customRooms: {
      maxPlayers: 4,
      maxSpectators: 1,
      defaultSettings: { map: "forest" },
    },
    matchmakingPools: [
      {
        id: "solo-1v1",
        gameId: "supabase",
        seasonId: "season-1",
        mode: "duel-1v1",
        region: "jp",
        matchRoom: {
          settings: { map: "forest" },
          metadata: { name: "supabase duel" },
          teamIds: ["blue", "red"],
          maxPlayers: 2,
          minimumPlayers: 2,
          requireAllPlayersReady: false,
        },
      },
    ],
    authenticate: (request) =>
      authenticateSupabaseRequest(request, supabaseUrl),
    authorization: {
      authorizeHostOperation: () => true,
      authorizeJoin: () => true,
      authorizeSpectate: () => true,
      authorizeMatchResult: () => false,
    },
    inputLimits: {
      maxHttpRequestBytes: 16 * 1024,
      maxWebSocketMessageBytes: 8 * 1024,
      maxMessagesPerMinute: 60,
      maxRoomCreationsPerMinute: 10,
    },
    cors: {
      allowedOrigins: ["http://localhost:5173"],
    },
  });

  return lobby.createGatewayWorker<SupabaseWorkerEnv>();
}

const worker = {
  fetch(request, env, ctx) {
    return createSupabaseWorker(env.SUPABASE_URL).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<SupabaseWorkerEnv>;

export default worker;

export {
  MatchPoolDurableObject,
  PartyDurableObject,
  PartyMembershipDurableObject,
  RateLimitDurableObject,
  RoomDurableObject,
} from "@flarelobby/cloudflare";
