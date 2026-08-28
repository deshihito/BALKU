# BALKU | Builder Card Game

素材を集めて企画を完成させ、疑わしければBALKUする、2〜4人用のルーム同期型オンライン対戦カードゲームです。

## 技術構成

React 19、Vite、TypeScript、Tailwind CSS、Express、tRPC、Drizzle ORM、MySQL/TiDBを使用しています。ゲーム状態はサーバー側のデータベースへ保存し、クライアントはルーム状態を定期同期します。

## ローカル開発

```bash
pnpm install
pnpm dev
```

型検査、テスト、本番ビルドは次のコマンドで実行できます。

```bash
pnpm check
pnpm test
pnpm build
```

## Render設定

RenderのWeb Serviceとして次の設定を使用します。

| 項目 | 値 |
|---|---|
| Build Command | `pnpm install --frozen-lockfile && pnpm build` |
| Start Command | `pnpm start` |
| Runtime | Node |
| Node Version | `22` |

アプリケーションはRenderが提供する `PORT` を使用します。固定ポートを設定しないでください。

## 必要な環境変数

データベース接続とサーバー実行に必要な値はRenderのEnvironmentへ登録してください。値そのものはリポジトリへコミットしません。

| 変数 | 用途 |
|---|---|
| `DATABASE_URL` | MySQL/TiDB接続文字列 |
| `JWT_SECRET` | セッション署名用の秘密鍵 |
| `VITE_APP_ID` | Manus OAuthを利用する場合のアプリケーションID |
| `OAUTH_SERVER_URL` | OAuthサーバーURL |
| `VITE_OAUTH_PORTAL_URL` | OAuthポータルURL |
| `OWNER_OPEN_ID` | 所有者情報 |
| `OWNER_NAME` | 所有者名 |
| `BUILT_IN_FORGE_API_URL` | 組み込みAPIを利用する場合のサーバーURL |
| `BUILT_IN_FORGE_API_KEY` | 組み込みAPIのサーバーキー |
| `VITE_FRONTEND_FORGE_API_URL` | フロントエンドAPI URL |
| `VITE_FRONTEND_FORGE_API_KEY` | フロントエンドAPIキー |

匿名ルーム参加を中心に利用する場合でも、サーバー起動とゲーム状態保存のため `DATABASE_URL` は必須です。OAuthを使わない場合は、アプリケーション側の認証導線に合わせてOAuth関連変数を設定してください。

## 注意事項

このリポジトリには秘密鍵、`.env`ファイル、依存パッケージ、ビルド生成物を含めていません。Renderではデータベースを別途用意し、TLS接続を有効にしてください。Manus固有の組み込みAPIやOAuthをRenderから利用する場合は、対応する本番用URLとキーをRenderの環境変数へ登録する必要があります。
