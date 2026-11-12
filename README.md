# maneger_app

タスク管理・メール管理（Gmail）・大学の課題（AIMS）をまとめて管理する Web アプリです。

- フレームワーク: Next.js（TypeScript, App Router）
- データベース: SQLite（`better-sqlite3`、ファイルは `data/app.db`）

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
