import { createFlareLobbyClient } from "@flarelobby/client";
import type { FlareLobbyApp } from "@flarelobby/core";

type ExampleApp = FlareLobbyApp<
  { map: "forest" | "desert" },
  { name: string },
  { chat: { text: string } }
>;

declare const auth: { getAccessToken(): string | Promise<string> };

const lobby = createFlareLobbyClient<ExampleApp>({
  endpoint: "https://lobby.example.com",
  getAccessToken: () => auth.getAccessToken(),
  requestTimeoutMs: 10_000,
  connectionTimeoutMs: 10_000,
  commandTimeoutMs: 10_000,
});

const host = await lobby.createCustomRoom({
  name: "型検査対象のルーム",
  visibility: "unlisted",
  joinMethod: "invitation",
  settings: { map: "forest" },
});

const stop = host.onMessage("chat", (message) => {
  const text: string = message.payload.text;
  console.log(text);
});

await host.setReady(true);
await host.send("chat", { text: "準備完了" });
await lobby.request("/v1/example", { timeoutMs: 5_000 });
const timedConnection = await lobby.connect("/v1/rooms/room-1/ws", {
  timeoutMs: 5_000,
});
await timedConnection.send(
  "room.set_ready",
  { ready: true },
  { timeoutMs: 5_000 },
);
timedConnection.close();
const spectator = await lobby.joinCustomRoom({
  roomId: host.id,
  role: "spectator",
});
await spectator.leave();
stop();
await host.leave();
