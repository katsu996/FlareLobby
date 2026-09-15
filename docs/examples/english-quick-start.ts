import { createFlareLobbyClient } from "@flarelobby/client";

declare const auth: { getAccessToken(): Promise<string> };

const lobby = createFlareLobbyClient({
  endpoint: "https://lobby.example.com",
  getAccessToken: () => auth.getAccessToken(),
});

await lobby.createCustomRoom({
  name: "My room",
  visibility: "unlisted",
  joinMethod: "invitation",
});
