# maneger_app

タスク管理・メール管理（Gmail）・大学の課題（AIMS）をまとめて管理する Web アプリです。

- フレームワーク: Next.js（TypeScript, App Router）
- データベース: SQLite（Node.js に内蔵の `node:sqlite`、ファイルは `data/app.db`）
- 必要なもの: Node.js 22.13 以上（https://nodejs.org/ja の LTS 版で OK）

## 動かし方

```bash
npm ci
npm run dev
```

ブラウザで http://localhost:3000 を開きます。

## AIMS（大学の課題）との連携

AIMS は Moodle で動いているので、Moodle の Web サービス API で課題を取り込みます。

1. `.env.example` をコピーして `.env.local` を作ります（`.env.local` は Git に入りません）。
2. `MOODLE_TOKEN` に自分のトークンを入れます。トークンの探し方：
   - AIMS にログインして、右上のメニューから「プロフィール」→「セキュリティキー」（`/user/managetoken.php`）を開き、
     「Moodle mobile web service」のキーをコピーします。
   - そのページが見当たらない場合は、大学の設定で使えない可能性があります。
3. アプリを起動して「課題」画面の「AIMS から取り込む」を押します。

トークンはパスワードと同じくらい大事な情報です。チャットや Git には貼らないでください。

## Gmail との連携

Google の OAuth（ログインして「このアプリが Gmail を読んでよい」と許可する仕組み）を使います。
アプリが受け取るのは **読み取り専用** の権限（`gmail.readonly`）だけで、メールの送信や削除はできません。

### 1. Google Cloud で準備する（最初の 1 回だけ）

1. https://console.cloud.google.com/ を開き、新しいプロジェクトを作ります。
2. 「API とサービス」→「ライブラリ」で **Gmail API** を探して「有効にする」を押します。
3. 「Google Auth Platform」（または「OAuth 同意画面」）を開いて設定します。
   - 対象：**外部**
   - 「テストユーザー」に自分の Gmail アドレスを追加します。
4. 「クライアント」（または「認証情報」→「OAuth クライアント ID を作成」）で次のように作ります。
   - アプリケーションの種類：**ウェブ アプリケーション**
   - 承認済みのリダイレクト URI：`http://localhost:3000/api/auth/google/callback`
5. 表示された **クライアント ID** と **クライアント シークレット** を `.env.local` に書きます。

```
GOOGLE_CLIENT_ID=（クライアント ID）
GOOGLE_CLIENT_SECRET=（クライアント シークレット）
```

### 2. アプリから接続する

1. `npm run dev` で起動して、「メール」画面の「Gmail に接続」を押します。
2. Google の画面で自分のアカウントを選び、許可します。
   「このアプリは Google で確認されていません」と出たら、「詳細」→「（アプリ名）に移動」で進めます（自分で作ったアプリなので問題ありません）。
3. 「Gmail から取り込む」を押すと、受信トレイの最新 30 件が表示されます。

### 注意

- Google 側が「テスト中」のアプリでは、約 7 日で接続が切れます。切れたら「Gmail に接続」を押し直してください。
- ログイン情報は `data/app.db`（Git に入らないファイル）に保存されます。「接続を解除」を押すと削除され、Google 側の許可も取り消されます。
