# JSON 通信プロトコル v1

`@flarelobby/core` が定義する JSON 通信契約です。HTTP と WebSocket は同じ Envelope とエラー体系を使います。第 1 版は JSON だけを対象とし、MessagePack などのバイナリ形式は扱いません。

## 共通 Envelope

すべてのメッセージは、次の 2 項目を必須で持ちます。

| 項目 | 型 | 意味 |
| --- | --- | --- |
| `protocolVersion` | `1` | 通信契約の版番号。第 1 版では必ず数値の `1` |
| `kind` | `"command"` / `"success"` / `"failure"` / `"event"` | メッセージの種類 |

受信側は、数値として解釈できない版番号を `INVALID_MESSAGE`、`1` 以外の版番号を `UNSUPPORTED_PROTOCOL_VERSION` として明示的に拒否します。HTTP の本文と WebSocket の各フレームのどちらにも同じ規則を適用します。

## コマンド

クライアントからサーバーへ送るコマンドは次の形です。

| 項目 | 型 | 意味 |
| --- | --- | --- |
| `protocolVersion` | `1` | 共通 Envelope の版番号 |
| `kind` | `"command"` | コマンドを表す固定値 |
| `requestId` | 空文字列ではない文字列 | クライアントが操作ごとに生成する不透明な識別子 |
| `command` | 空文字列ではない文字列 | 実行するコマンド種別 |
| `payload` | JSON 値 | そのコマンドの入力。ゲーム固有の具体的な構造は各コマンド仕様で定義する |

```json
{
  "protocolVersion": 1,
  "kind": "command",
  "requestId": "01HZX8M9H5QF1V0Y9J4Y6E3A7B",
  "command": "room.set_ready",
  "payload": { "ready": true }
}
```

同一操作の再送では、クライアントは `requestId`、`command`、`payload` を変更してはいけません。サーバーは、認証済み主体と操作対象（Room または Match Pool）の組に `requestId` を加えたキーで処理済み結果を保持します。同じキーの再送は状態変更を再実行せず、最初の成功または失敗応答を返します。同じキーで `command` または `payload` が異なる場合は `CONFLICT` として拒否します。

`isDuplicateRequest()` は、同じ処理文脈へ到達した 2 コマンドの `requestId` が一致するかを判定する補助関数です。保持期間や永続化は、各実行基盤が定めます。

## 成功応答と失敗応答

成功応答は、対応するコマンドを `requestId` で関連付けます。

| 項目 | 型 | 意味 |
| --- | --- | --- |
| `protocolVersion` | `1` | 共通 Envelope の版番号 |
| `kind` | `"success"` | 成功を表す固定値 |
| `requestId` | 空文字列ではない文字列 | 対応するコマンドの識別子 |
| `payload` | JSON 値 | コマンドの結果。値がない場合は `null` を使用する |

失敗応答は、安全に公開可能なエラーだけを含めます。

| 項目 | 型 | 意味 |
| --- | --- | --- |
| `protocolVersion` | `1` | 共通 Envelope の版番号 |
| `kind` | `"failure"` | 失敗を表す固定値 |
| `requestId` | 文字列または `null` | 対応するコマンド。要求識別子を読む前に拒否した場合だけ `null` |
| `error.code` | `FlareLobbyErrorCode` | 機械判定に使う安定したコード |
| `error.message` | 文字列 | 利用者へ表示してよい文言。分岐には使わない |

```json
{
  "protocolVersion": 1,
  "kind": "failure",
  "requestId": "01HZX8M9H5QF1V0Y9J4Y6E3A7B",
  "error": {
    "code": "ROOM_FULL",
    "message": "ルームは満員です。"
  }
}
```

## サーバーイベント

接続済みクライアントへ配信するイベントは、コマンド応答と独立して次の形を取ります。

| 項目 | 型 | 意味 |
| --- | --- | --- |
| `protocolVersion` | `1` | 共通 Envelope の版番号 |
| `kind` | `"event"` | イベントを表す固定値 |
| `event` | 空文字列ではない文字列 | 受信側の登録済みイベント種別 |
| `revision` | 0 以上の安全な整数 | このイベントを反映した後のルーム版番号 |
| `payload` | JSON 値 | イベント固有のデータ。ゲーム固有の具体的な構造は各イベント仕様で定義する |

```json
{
  "protocolVersion": 1,
  "kind": "event",
  "event": "room.snapshot",
  "revision": 8,
  "payload": { "roomId": "room-1" }
}
```

クライアントは初期スナップショットの `revision` を保存し、後続イベントを `classifyEventRevision()` で比較します。

| 判定 | 条件 | 受信側の扱い |
| --- | --- | --- |
| `next` | `event.revision === lastRevision + 1` | イベントを適用し、版番号を更新する |
| `duplicate` | `event.revision === lastRevision` | 再送として破棄する |
| `gap` | `event.revision > lastRevision + 1` | 欠落を検出し、差分再送または完全スナップショット復元を要求する |
| `out_of_order` | `event.revision < lastRevision` | 順序逆転として破棄し、必要なら再同期する |

サーバーは状態変更のたびに `revision` を単調増加させ、同じルームのイベントをその順序で配信します。受信側は未知の `event` を適用してはいけません。`decodeServerMessage()` へ `knownEventTypes` を渡すと、登録されていないイベントは `UNKNOWN_EVENT` で拒否できます。

Room の初回接続または再接続時の `room.snapshot` は、通常のスナップショット項目に加えて
次の再開 Handshake 項目を Payload へ持てます。

| 項目 | 型 | 意味 |
| --- | --- | --- |
| `resumeToken` | 文字列 | 次回接続の認証用 subprotocol へ渡す期限付き再開トークン |
| `resumeTokenExpiresAt` | 数値 | 再開トークンの Unix epoch milliseconds の期限 |
| `resume` | オブジェクト | `participantId`、`role`、`resumed` を含む接続結果 |

再接続要求は最後に適用した `revision` を `lastRevision` Query または
`x-flarelobby-last-revision` Header で指定します。サーバーは有界履歴から連続した
差分を返せる場合だけ順番に再送し、履歴不足や範囲外では完全スナップショットへ切り替えます。
再開トークンは明示的な `leave()` 後には無効です。

## 公開エラー

`FlareLobbyError` は安全な `message` と、表示文言から独立した `code` を持ちます。HTTP と WebSocket の失敗は同じコードへ正規化します。

| コード | 意味 |
| --- | --- |
| `CONNECTION_FAILED` | 接続または通信路の確立・維持に失敗した |
| `UNAUTHENTICATED` | 認証が必要、または認証情報が無効である |
| `FORBIDDEN` | 認証済みだが操作権限がない |
| `ROOM_FULL` | ルームの参加可能人数が上限に達している |
| `ROOM_FINISHED` | 終了済みルームへ許可されない操作を行った |
| `CONFLICT` | 現在の状態、または同じ `requestId` の内容と競合した |
| `CANCELLED` | 利用者または取消シグナルにより操作を中止した |
| `INVALID_MESSAGE` | Envelope の形式、必須項目、またはメッセージ種別が不正である |
| `INVALID_PAYLOAD` | JSON は読めるが、操作固有の `payload` の型・値・必須条件が不正である |
| `UNSUPPORTED_PROTOCOL_VERSION` | 既知でない必須プロトコル版を受信した |
| `UNKNOWN_EVENT` | 受信側に登録されていないイベント種別を受信した |

`error.message`、内部例外文、スタックトレース、認証トークン、Durable Object 識別情報は通信へ含めません。アプリケーションは `error.code` だけで制御フローを判断し、`message` は表示のためだけに使用します。

## エンコード、デコード、検証

`encodeProtocolMessage()`、`decodeProtocolMessage()`、`decodeClientCommand()`、`decodeServerMessage()`、`validateProtocolMessage()` はすべて `ProtocolResult` を返します。失敗時は例外を送出せず、`{ ok: false, error: FlareLobbyError }` を返します。JSON 構文エラー、必須項目の欠落、不正な Payload、未知版、未知イベントは内部例外を公開せず上記の安定したコードへ変換します。
