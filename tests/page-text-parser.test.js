const test = require("node:test");
const assert = require("node:assert/strict");
const { parseLlFansPage } = require("../admin/js/page-text-parser.js");

const sample = `
TOP
データベース
イベント・TV出演
いきづらい部！ 1st LIVE ～ What is my L ? ～
ライブ・ファンミ
イキヅライブ！ LOVELIVE! BLUEBIRD
日程
2026年02月14日(土) 〜 2026年02月15日(日)
公式ページ
https://www.lovelive-anime.jp/lovehigh/live/live_detail.php?_id=WhatismyL
会場
幕張メッセ 幕張イベントホール
備考
-
有観客
日程
2026年02月14日(土)
開場時刻
16:30
開演時刻
17:30
セットリスト
衣装情報を全て表示
M01
What is my LIFE?
MC①
M02
浅草Guilty Girlの歌
M03
Public Style
M04
いつか碧
M05
HIBANA―火花―
M06
凸凹Quartet
初
M07
Pray for love
M08
キミは夜のポラリス
M09
Little Green委員会
M10
Daitan Party Time
初
M11
HomeRun Queen!!
M12
恋のワンタイムパスワード
M13
イキタクナイevery day
M14
シンメトリー
初
M15
Silent Stella
初
幕間①
M16
REGAIN AGAIN LLLLOVE
初
MC②
告知: ラブライブ！シリーズとパ・リーグのコラボ
M17
オドルポルカ
M18
Trick or Toxic
M19
センチメートル・ランデヴー
M20
LOVE♡YOU♡Save the EARTH!!
M21
クラリトブライト
M22
マジカル♡レシピ・シルブプレ！
M23
二人はいつでもHappy End
M24
First Ride
M25
ジェットスターター
M26
ひっさつマイマイモード
M27
ヒミツミチ
Encore
幕間映像
EN01
Dou-Da? DOING!
初
MC③
EN02
What is my LIFE?
幕間②
LL-Fans
`;

test("LL-Fans本文から現行JSONに必要な29曲を抽出する", () => {
  const parsed = parseLlFansPage(sample);

  assert.equal(parsed.event.title, "いきづらい部！ 1st LIVE ～ What is my L ? ～");
  assert.deepEqual(parsed.event.series, ["ikizulive"]);
  assert.equal(parsed.event.idSuggestion, "ikizulive-1st-live-what-is-my-l");
  assert.equal(
    parsed.event.source.url,
    "https://www.lovelive-anime.jp/lovehigh/live/live_detail.php?_id=WhatismyL"
  );
  assert.equal(parsed.performance.date, "2026-02-14");
  assert.equal(parsed.performance.day, 1);
  assert.equal(parsed.performance.idSuggestion, "ikizulive-1st-live-what-is-my-l");
  assert.equal(parsed.performance.venue.name, "幕張メッセ 幕張イベントホール");
  assert.equal(parsed.setlist.length, 29);
  assert.deepEqual(parsed.setlist[0], {
    marker: "M01",
    title: "What is my LIFE?",
    version: "",
    artistHint: ""
  });
  assert.equal(parsed.setlist[27].marker, "EN01");
  assert.equal(parsed.setlist[27].title, "Dou-Da? DOING!");
  assert.equal(parsed.setlist[28].marker, "EN02");
  assert.equal(parsed.setlist[28].title, "What is my LIFE?");
  assert.equal(parsed.setlist.some((item) => /MC|幕間|告知|Encore|初/.test(item.title)), false);
  assert.equal(Object.hasOwn(parsed.performance, "startTime"), false);
  assert.equal(Object.hasOwn(parsed.performance, "doorsOpenTime"), false);
  assert.equal(Object.hasOwn(parsed.setlist[5], "isFirstPerformance"), false);
  assert.deepEqual(parsed.warnings, []);
});

test("番号と曲名が同じ行でも解析できる", () => {
  const parsed = parseLlFansPage(`
イベント・TV出演
テスト 1st LIVE
ライブ・ファンミ
test-series
日程
2026年3月1日
公式ページ
https://example.com/live
会場
テスト会場
有観客
日程
2026年3月1日
セットリスト
M01. First Song
EN1: Last Song（104期 Ver.）
`);

  assert.deepEqual(
    parsed.setlist.map((item) => [item.marker, item.title, item.version]),
    [
      ["M01", "First Song", ""],
      ["EN01", "Last Song", "104期 Ver."]
    ]
  );
});

test("シリーズ名と公演名からローマ字IDを生成する", () => {
  const hasunosora = parseLlFansPage(`
イベント・TV出演
蓮ノ空女学院スクールアイドルクラブ 1st Live Tour ～RUN！CAN！FUN！～
ライブ・ファンミ
蓮ノ空女学院スクールアイドルクラブ
日程
2023年10月21日
公式ページ
https://example.com/hasunosora
会場
テスト会場
有観客
日程
2023年10月21日
セットリスト
M01
Dream Believers
`);

  assert.deepEqual(hasunosora.event.series, ["hasunosora"]);
  assert.equal(
    hasunosora.performance.idSuggestion,
    "hasunosora-1st-live-tour-run-can-fun"
  );

  const nijigasaki = parseLlFansPage(`
イベント・TV出演
虹ヶ咲学園スクールアイドル同好会 7th Live! NEW TOKIMEKI LAND
ライブ・ファンミ
虹ヶ咲学園スクールアイドル同好会
日程
2024年10月19日
公式ページ
https://example.com/nijigasaki
会場
テスト会場
有観客
日程
2024年10月19日
セットリスト
M01
虹色Passions！
`);

  assert.deepEqual(nijigasaki.event.series, ["nijigasaki"]);
  assert.equal(
    nijigasaki.performance.idSuggestion,
    "nijigasaki-7th-live-new-tokimeki-land"
  );
});
