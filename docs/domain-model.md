# 公開ドメイン型

`@flarelobby/core` は Cloudflare、HTTP、WebSocket、永続化実装に依存しない公開ドメイン型を提供します。この文書は Issue #3 で定義した用語と型の対応を示します。

## 用語と型の対応

| 用語 | 公開型 | 説明 |
| --- | --- | --- |
| プレイヤー | `Player` | ルームまたはマッチングへ参加するゲームプレイヤー |
| 認証主体 | `Principal` | サーバー側で認証済みの主体。`playerId` は認証結果から決定する |
| ルーム | `Room` | `CustomRoom` または `MatchRoom` の判別可能な Union |
| カスタムルーム | `CustomRoom` | 招待コードと公開・一覧非表示の可視性を持つ利用者作成ルーム |
| 対戦ルーム | `MatchRoom` | マッチング成立時に生成され、`matchId` とプールを持つルーム |
| 参加者 | `Participant` | `PlayerParticipant` または `Spectator` |
| ホスト | `Host` | カスタムルームの管理操作を行う参加者 |
| 観戦者 | `Spectator` | チームと準備状態を持たない参加者 |
| チーム | `Team` | ルーム内のチーム識別子 |
| スナップショット | `RoomSnapshot` | 特定 `revision` 時点の読み取り専用ルーム状態 |
| マッチングプール | `MatchmakingPool` | ゲーム、シーズン、モード、リージョンで分割される待機集合 |
| マッチングチケット | `MatchmakingTicket` | 待機プールへの参加とその進行状態 |
| 候補 | `MatchCandidate` | 1 対 1 で成立を検討する 2 件のチケット |
| 成立結果 | `MatchResult` | 候補から生成された `MatchRoom` と `matchId` |
| レーティング | `Rating` | プレイヤーとプールに対応する現在の数値 |

## ルーム状態

`RoomState` は `status` による判別可能な Union です。終了済みから別の状態へ戻す遷移はこの型の利用側で作らず、状態遷移ロジックで拒否します。

| `status` | 型 | 必須項目 |
| --- | --- | --- |
| `waiting` | `WaitingRoomState` | なし |
| `preparing` | `PreparingRoomState` | `preparationStartedAt` |
| `in_progress` | `InProgressRoomState` | `startedAt` |
| `finished` | `FinishedRoomState` | `finishedAt` |

`RoomSnapshot.revision` は各状態変更で単調増加する数値です。購読側は前回値との比較で欠落または順序逆転を検出できます。`participants`、`teams`、`room.settings`、`room.metadata` は読み取り専用です。

## マッチングチケット状態

`MatchmakingTicket` も `status` による判別可能な Union です。成立結果は `matched` のときだけ、候補は `reserved` のときだけ参照できます。

| `status` | 型 | 必須項目 |
| --- | --- | --- |
| `creating` | `CreatingMatchmakingTicket` | なし |
| `waiting` | `WaitingMatchmakingTicket` | `queuedAt` |
| `reserved` | `ReservedMatchmakingTicket` | `candidate`、`reservedAt` |
| `matched` | `MatchedMatchmakingTicket` | `result`、`matchedAt` |
| `cancelled` | `CancelledMatchmakingTicket` | `cancelledAt` |
| `expired` | `ExpiredMatchmakingTicket` | `expiredAt` |

## ゲーム固有型の指定

利用者は `FlareLobbyApp` の 3 つの型引数で、ルーム設定、メタデータ、ゲーム固有メッセージを結び付けます。これらの値は JSON として直列化可能な形にしてください。

```ts
import type {
  FlareLobbyApp,
  GameMessage,
  RoomSnapshot
} from "@flarelobby/core";

type GameApp = FlareLobbyApp<
  { maxPlayers: number; map: "forest" | "desert" },
  { title: string },
  {
    move: { direction: "north" | "south" };
    emote: { value: "wave" | "cheer" };
  }
>;

declare const snapshot: RoomSnapshot<GameApp>;

const message: GameMessage<GameApp> = {
  name: "move",
  payload: { direction: "north" }
};

// snapshot.room.settings.map = "desert"; // 読み取り専用のため型エラー
```

`InferFlareLobbyApp<T>` は `RoomSnapshot`、`MatchmakingTicket`、`MatchResult`、`GameMessage` などの公開型に結び付いたアプリケーション定義を型レベルで取り出すための契約です。後続パッケージは同じ `TApp` を受け取り、設定・メタデータ・メッセージの対応を維持します。
