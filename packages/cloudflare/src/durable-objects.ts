import { DurableObject } from "cloudflare:workers";

/**
 * 1 ルーム単位の強整合な状態を保持する Durable Object です。
 *
 * 具体的なルーム業務ロジックは後続 Issue で実装します。このクラスは Wrangler が
 * 静的に認識できる公開 Export と SQLite-backed Durable Object の起点を提供します。
 */
export class RoomDurableObject extends DurableObject<Env> {}

/**
 * 1 マッチングプール単位の待機チケットを保持する Durable Object です。
 *
 * プールの候補探索と成立処理は後続 Issue で実装します。
 */
export class MatchPoolDurableObject extends DurableObject<Env> {}
