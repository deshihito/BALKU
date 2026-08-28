# BALKU | Builder Card Game

素材を集めて企画を完成させ、疑わしければBALKUする、2〜4人用のルーム同期型オンライン対戦カードゲームです。

## 技術構成

React 19、Vite、TypeScript、Tailwind CSS、Express、tRPC、Drizzle ORM、Supabase REST APIを使用しています。ゲーム状態はSupabase PostgreSQLへ保存し、クライアントはルーム状態を定期同期します。

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
| `SUPABASE_URL` | SupabaseプロジェクトURL |
| `SUPABASE_KEY` | サーバーからSupabase REST APIへ接続するキー |

アカウント認証は使用せず、ルーム参加時に発行するプレイヤートークンでゲーム操作を認可します。ゲームサーバーは `SUPABASE_URL` と `SUPABASE_KEY` でSupabase REST APIへ接続します。`PORT` はRenderが自動的に設定します。

## 注意事項

このリポジトリには秘密鍵、`.env`ファイル、依存パッケージ、ビルド生成物を含めていません。初回デプロイ前に、Supabase DashboardのSQL Editorで `drizzle/0000_curvy_harry_osborn.sql` を一度だけ実行してテーブルを作成してください。`SUPABASE_KEY` はクライアントへ公開せず、Renderのサーバー環境変数だけに登録します。RenderのWeb Service URLとカスタムドメインはRender側で管理します。
