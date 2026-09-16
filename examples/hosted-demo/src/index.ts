/**
 * 公開デモ専用の Worker entry です。
 *
 * local-demo のローカル専用認証（任意 Bearer / x-demo-player）は公開 entry
 * から import しません。認証は Supabase JWT 検証だけを使い、匿名ログインの
 * token も有効な JWT として検証します。一般利用者の `authorizeMatchResult`
 * は false のため、勝敗の直送は受け付けず、RPS の手だけを受け付けます。
 */
import type { FlareLobbyBindings } from "@flarelobby/cloudflare";
import { createHostedDemoGateway } from "./gateway.js";
import { authenticateHostedRpsRequest, handleHostedRpsRequest } from "./rps.js";

type HostedDemoAssets = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

type HostedDemoEnv = FlareLobbyBindings & {
  readonly ASSETS: HostedDemoAssets;
  readonly SUPABASE_URL: string;
};

const demoWorker = {
  async fetch(
    request: Request,
    env: HostedDemoEnv,
    context: ExecutionContext,
  ): Promise<Response> {
    const lobby = createHostedDemoGateway(env.SUPABASE_URL);
    const gateway = lobby.createGatewayWorker<HostedDemoEnv>();
    const pathname = new URL(request.url).pathname;

    if (request.method === "GET" && pathname === "/health") {
      return Response.json({ status: "ready" });
    }

    if (pathname.startsWith("/v1/demo/rps/")) {
      const authenticated = await authenticateHostedRpsRequest(
        request as unknown as Request<
          unknown,
          IncomingRequestCfProperties<unknown>
        >,
        lobby.configuration,
        env.FLARE_LOBBY_TOKEN_SECRET,
      );

      if (authenticated instanceof Response) {
        return authenticated;
      }

      const response = await handleHostedRpsRequest(
        request,
        env,
        lobby.configuration,
        authenticated,
      );

      if (response !== null) {
        return response;
      }

      return new Response("Not Found", { status: 404 });
    }

    if (!pathname.startsWith("/v1/")) {
      return env.ASSETS.fetch(request);
    }

    return gateway.fetch(
      request as unknown as Parameters<NonNullable<typeof gateway.fetch>>[0],
      env,
      context,
    );
  },
};

export default demoWorker satisfies ExportedHandler<HostedDemoEnv>;
export {
  MatchPoolDurableObject,
  PartyDurableObject,
  PartyMembershipDurableObject,
  RateLimitDurableObject,
  RoomDurableObject,
} from "@flarelobby/cloudflare";
