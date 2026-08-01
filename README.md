# Setlist Playlists 0.4

ラブライブ！シリーズのライブ情報とセットリストを公開し、作成用Spotifyアカウントの共有プレイリストを閲覧者へ提供するサイトです。

- 公開ページ: `/`
- 管理画面: `/admin/`
- 公演JSON: `/data/{シリーズID}/`

## 起動

普段はプロジェクト直下の `start-setlist.bat` をダブルクリックしてください。専用サーバーを起動し、管理画面を自動的に開きます。停止するときはBATの画面で `Ctrl+C` を押すか、ウィンドウを閉じます。既にサーバーが動いている場合は二重起動せず、管理画面だけを開きます。

公開ページを直接開きたい場合は、PowerShellから次のように起動できます。

```powershell
.\start-setlist.bat public
```

手動で起動する場合は、プロジェクトフォルダでPowerShellを開き、専用サーバーを実行します。

```powershell
python server.py
```

ブラウザで次のURLを開きます。

```text
公開ページ  http://127.0.0.1:8765/
管理画面    http://127.0.0.1:8765/admin/
```

`python -m http.server` でも公開ページは表示できますが、LL-Fans URLからの一括取得は動作しません。管理画面を使う場合は `server.py` を起動してください。

## 公開ページ

公演JSONは `data/hasunosora/`、`data/nijigasaki/` のように、イベントの先頭シリーズIDごとのフォルダへ保存します。シリーズ未設定のイベントは `data/other/` に保存します。`data/index.json` に列挙した相対パスを読み込み、次の機能を提供します。

- 公演名・会場名の検索
- シリーズによる絞り込み
- 公演回／Dayの切り替え
- セットリストとSpotify登録状況の確認
- Spotifyログイン不要の共有プレイリスト作成・表示
- 共有SpotifyプレイリストからApple Music・Amazon Musicへの外部移行

プレイリストには有効な `spotify.uri` がある曲だけをセットリスト順で追加します。同じ曲が複数回ある場合も曲順どおり残します。Spotify未配信曲と未登録曲は除外し、作成前に対象曲数を表示します。初回リクエスト時だけCloudflare Workerが作成用アカウントでプレイリストを作成し、同じ公演の2回目以降はD1に保存した既存URLを返します。

Apple Music・Amazon Musicへの移行にはTuneMyMusicを利用します。移行ボタンを押すとSpotifyプレイリストURLをクリップボードへコピーし、選択したサービス向けの移行画面を開きます。移行先サービスの認証情報は当サイトでは扱いません。

訪問ページのSpotify登録済み曲にはアルバムジャケットを表示します。新しく登録する曲はジャケットURLをJSONへ保存し、既存データはSpotify公式oEmbedから画像を補完します。同じTrack IDの画像取得結果はページ内で再利用します。

ローカル環境では、管理画面のlocalStorageに保存されている公演も自動的に公開ページへ反映されます。管理画面の「全公演をGitHubへ公開」を押すと、管理画面に保存されている全イベントのJSONを `data/` に保存し、`data/index.json` の更新、commit、pushまでをまとめて実行します。

```json
{
  "schemaVersion": "0.3",
  "events": [
    "hasunosora/hasunosora-1st-live-tour-run-can-fun.json",
    "hasunosora/hasunosora-2nd-live-tour-blooming-with.json"
  ]
}
```

## 管理画面でLL-Fansから公演を追加

イベントページのURL（例: `https://ll-fans.jp/data/event/288`）を貼り付けて「全公演を取得」を押すと、会場・Dayに分かれた公演をまとめて取得します。

1. `/admin/` で「LL-Fansから追加」を押す
2. LL-FansのイベントURLを貼り付ける
3. 「全公演を取得」を押す
4. 各公演のイベント情報、セットリスト、Spotify検索結果を確認する
5. 「公演をJSON化して登録」を押す
6. 未登録曲があれば、表示された候補を設定するか「この曲を未配信として登録」で次の曲へ進む
7. 最後の未登録曲を確認すると登録が自動的に完了する
8. 管理画面上部の「全公演をGitHubへ公開」を押す
9. 公開用JSONの保存、`data/index.json` の更新、commit、pushが自動実行される

複数の新規公演をまとめて追加する場合は「未登録公演を同期」を押します。LL-Fansの公演一覧とローカルデータを比較し、未登録公演だけを表示します。シリーズや公演名で絞り込み、複数選択して取り込めます。登録済み曲とSpotifyで一意に一致した曲は自動反映し、判断できない曲だけを一曲ずつ確認します。一覧は10分間キャッシュされ、「一覧を更新」を押した場合のみLL-Fansから取り直します。

一括取込はローカル管理画面への登録までです。取り込まれた内容を確認し、「全公演をGitHubへ公開」を一度押すと、管理画面内の全公演をまとめて反映できます。

Spotify接続済みなら解析後に曲検索とアーティスト補完を自動実行します。MC、幕間、告知、「初」、開場・開演時刻など、schema 0.3に存在しない項目は保存しません。

会場は任意入力です。配信・バーチャル公演などで会場がない場合や、LL-Fansの会場表示がハイフンの場合は「-」として保存します。

ナンバリング公演は公演名から自動判定しません。管理画面のイベント情報で「ナンバリング公演」に手動でチェックを付けると、管理画面と公開サイトの「ナンバリング公演のみ」絞り込み対象になります。このフラグは公開JSONにも保存されます。

登録ボタンを押した時点でSpotify未登録の曲だけを、ジャケット付き候補画面で1曲ずつ確認できます。候補を選ぶか「未配信」として登録すると自動で次の曲へ進み、同じ「曲名＋バージョン」が複数公演にある場合は1回の確認結果をまとめて反映します。「確認を中止」しても、それまでのSpotify設定・未配信設定は保持されます。公開ページでは、未配信に設定した曲を「未配信」、Spotify情報をまだ設定していない曲を「未登録」と区別して表示します。

登録済み公演の「編集」を開き、「Spotifyで全曲再検索」を押すと、Spotify登録済みの曲も含めてセットリスト全曲を曲名だけで再検索します。一意に一致した曲はまとめて更新し、候補複数・見つからない曲は現在の登録を保持したまま個別確認に残します。最後に「公演を保存」を押すとTrack ID・URI・アーティスト名を確定します。各曲の「Spotifyで再検索」も引き続き利用できます。

候補から手動選択した「曲名＋バージョン → Spotify曲」は、その時点で確定履歴としてブラウザへ保存します。次回以降に同じ曲が現れた場合はSpotify検索より先に自動反映します。バージョン表記が異なっても、その曲名に保存されているTrack IDが1種類だけなら再利用し、複数のTrack IDがある場合だけ手動確認に戻します。確定履歴は「全データをバックアップ」にも含まれます。

シリーズ名は `nijigasaki`、`ikizulive`、`hasunosora` などのIDへ変換し、イベントIDと公演IDは公演名から生成します。

## GitHub Pagesへ公開

最初に空のGitHubリポジトリを作成し、このプロジェクトへ `origin` を1回だけ設定します。

```powershell
git remote add origin https://github.com/ユーザー名/リポジトリ名.git
```

GitHubのリポジトリ設定で、PagesのSourceを「GitHub Actions」に設定してください。以後はローカル管理画面の「全公演をGitHubへ公開」で更新できます。

公開操作では管理画面に保存されている全イベントを公開JSONへ書き出し、commit対象はこのプロジェクト内の未反映変更すべてです。pushに失敗した場合もローカルcommitは保持されるため、認証や通信を直してからもう一度「全公演をGitHubへ公開」を押すとpushを再試行できます。

`.github/workflows/pages.yml` は公開用の `index.html`、`css/`、`js/`、`data/` とSpotify認証コールバックに必要な1ファイルだけをGitHub Pagesへ配信します。管理画面本体、`server.py`、起動用BAT、テストは公開サイトに含まれません。

## Spotify接続

Spotify Developer Dashboardで、このアプリのRedirect URIに公開ページのルートURLを完全一致で登録してください。管理画面の認証もこのURLで受け取り、自動的に `/admin/` へ戻ります。

```text
http://127.0.0.1:8765/
```

GitHub Pagesへ公開する場合は、公開ページのルートURLも追加します。

```text
https://ユーザー名.github.io/リポジトリ名/
```

管理画面の認証にはAuthorization Code with PKCEを使用するため、Client Secretは不要です。認証情報はlocalStorageではなく、そのタブのsessionStorageにだけ保持します。

公開ページの閲覧者はSpotifyへ接続しません。Cloudflare Workerに保存した作成用アカウントの認証情報を使い、`playlist-modify-private` 権限で共有用プレイリストを作成します。認証情報はWorker Secretだけに保存し、公開JavaScriptやGitHubへ含めません。

管理画面のSpotify検索語には曲名だけを使用します。`104期 Ver.` などのバージョン欄があっても、Spotify側の曲名が完全一致で一意なら自動適用します。同じ曲がシングルとアルバムの両方に収録されていてもISRCが同じなら同一音源としてまとめます。別アーティストや異なるISRCの同名曲は自動決定せず、手動選択に回します。

## Cloudflare Worker

共有プレイリストAPIは `worker/` にあります。公開ページからは公演JSONの相対パスと公演IDだけを送り、Workerが公開済みJSONを再取得して曲リストを検証します。閲覧者が任意の曲名やSpotify URIを指定することはできません。

作成済みプレイリストはD1の `shared_playlists` に保存します。セットリストの曲順が変わった場合は、次のリクエスト時に既存プレイリストを更新します。

```text
https://setlist-playlists-api.ew-project.workers.dev
```

## テスト

```powershell
node --check admin/js/page-text-parser.js
node --check admin/js/known-song-cache.js
node --check admin/js/spotify-client.js
node --check admin/js/app.js
node --check js/public-playlist-client.js
node --check js/public-app.js
node --test tests/*.test.js
node --test worker/tests/*.test.mjs
python -m unittest discover -s tests -p "test_*.py" -v
```

管理データはブラウザのlocalStorageに保存されるため、定期的に管理画面の「全データをバックアップ」を実行してください。
