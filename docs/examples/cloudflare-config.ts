import { defineFlareLobby } from "@flarelobby/cloudflare";
import type { FlareLobbyBindings } from "@flarelobby/cloudflare";
import type { FlareLobbyApp } from "@flarelobby/core";

type ExampleApp = FlareLobbyApp<
  { map: "forest" | "desert" },
  { name: string },
  {}
>;

const lobby = defineFlareLobby<ExampleApp>({
  customRooms: {
    maxPlayers: 4,
    defaultSettings: { map: "forest" }
  },
  matchmakingPools: [],
  authenticate: async (request) => {
    const token = request.headers.get("authorization");
    const subject = await verifyApplicationToken(token);
    return subject === null
      ? null
      : { id: subject, playerId: subject };
  },
  inputLimits: {
    maxHttpRequestBytes: 16 * 1024,
    maxWebSocketMessageBytes: 8 * 1024,
    maxMessagesPerMinute: 60,
    maxRoomCreationsPerMinute: 10
  }
});

declare function verifyApplicationToken(
  authorization: string | null
): Promise<string | null>;

export default lobby.createGatewayWorker<FlareLobbyBindings>();
