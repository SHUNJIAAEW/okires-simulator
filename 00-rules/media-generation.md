# 00-rules/media-generation.md — メディア生成ツールの選定ガイド

> 動画・画像・音声・3D を生成する際に「どのツールを使うべきか」の判断基準。
> 部署横断で参照する。
>
> **基本方針: 画像・動画はまず Higgsfield を使う**（Plus プラン契約済み・コスト最適）

## 契約プラン（Higgsfield Plus）

- **月額**: $59 / **1200クレジット**/月（abe@growth-navi.com）
- **30日間無制限**: Seedance 2.0 高速版（最大8世代まで）
- **7日間無制限**: Nano Banana 2（2K）
- **365日間無制限**（追加クレジット消費なし）:
  - **GPT Image**（旧 gpt-image-1 相当）
  - Soul V2 & Cinema
  - Seedream 5.0 Lite / 4.5
  - Flux.2 Pro (1K)
  - Nano Banana
  - Kling O1 Image
- **並列生成**: 動画最大6本 / 画像最大8枚同時

→ 上記モデルは**実質無料**で使える。**クレジットは Veo / Kling 3.0 / 高画質モデル**でのみ消費。

## 使用可能なメディア生成ツール

| ツール | 起動方法 | 認証 | 強み | 残量確認 |
|---|---|---|---|---|
| **Higgsfield** | `higgsfield-generate` skill ／ `higgsfield` CLI | `higgsfield auth login`（済） | 画像/動画/3D/音声 オール対応・Plus 無制限多数 | `higgsfield account status` |
| **Runway** | Runway MCP（接続済） | OAuth済 | 動画特化・image-to-video | Runway dashboard |
| ~~OpenAI gpt-image-1~~ | （deprecated） | — | Higgsfield 経由の GPT Image を使う | — |
| ~~FLUX (fal.ai)~~ | （deprecated） | — | Higgsfield の Flux.2 Pro を使う | — |

## 用途別の優先順（Higgsfield ファースト）

### 静止画（資料・LP・サムネ・SNS）

| 用途 | 第1選択 | 第2選択 | 備考 |
|---|---|---|---|
| 文字入りサムネ | **Higgsfield `gpt_image`**（365日無制限） | Higgsfield `nano_banana_2` | テキスト描画品質で選ぶ |
| 資料の挿絵（写真風・白背景） | **Higgsfield `gpt_image`** | Higgsfield `flux_2_pro` | 365日無制限のため積極利用 |
| LP ヒーロー写真 | **Higgsfield `flux_2_pro`**（365日無制限） | Higgsfield `nano_banana_2` | 写真リアリズム |
| LP セクション挿絵 | **Higgsfield `seedream_4_5`**（365日無制限） | `gpt_image` | バリエーション豊富 |
| 商品撮影風 | **Higgsfield (product-photoshoot skill)** | `gpt_image` | 物販向けは専用skill |
| マーケットプレイス出品 | **Higgsfield (marketplace-cards skill)** | — | 規約準拠テンプレ内蔵 |
| キャラ一貫性が必要（人物） | **Higgsfield (soul-id + generate)** | — | Soul V2 365日無制限 |

### 動画

| 用途 | 第1選択 | 第2選択 | 備考 |
|---|---|---|---|
| YouTube B-roll（実写風） | **Higgsfield `seedance_2_0`（30日無制限）** | Veo 3.1 | 標準・無制限のため大量バッチも可 |
| SNS用ショート動画 | Higgsfield `seedance_2_0` | `kling3_0_turbo` | TikTok/Instagram用 |
| 画像→動画（image-to-video） | Higgsfield `seedance_2_0` | Runway | 既存画像をアニメ化 |
| 商品プロモ動画 | Higgsfield (Marketing Studio) | Runway | 商品マーケ特化 |
| UGC/プレゼンター動画 | Higgsfield (Marketing Studio) | — | アバター付き広告 |
| 重要シーン比較 | **Bake-Off**: Veo3.1 × Kling3.0 × Seedance2.0 | — | クレジット消費は3倍 |

### 音声

| 用途 | 第1選択 | 第2選択 |
|---|---|---|
| BGM/SE | Higgsfield (Sonilo/Mirelo) | — |
| YouTube ナレーション | VOICEVOX（無料・既存パイプライン） | — |

### 3D

| 用途 | 第1選択 |
|---|---|
| GLB/メッシュ生成 | Higgsfield (`multi_image_to_3d`) |

## 部署別の標準セット

| 部署 | 主な使い方 |
|---|---|
| **yt-dept** | yt-thumbnailer→Higgsfield/gpt-image-1。yt-scout-broll→Higgsfield動画/Runway |
| **sns-dept** | sns-creative-producer→Higgsfield動画/画像（プラットフォーム別最適化） |
| **deck-dept** | deck-designer→gpt-image-1（写真風）/FLUX（補助） |
| **web-dept** | web-designer→FLUX（ヒーロー）/Higgsfield（人物カット・soul-id 連携） |
| **resale-dept** | market-scout後の出品カード→Higgsfield (marketplace-cards) |
| **agency-dept** | デモLP挿絵→FLUX/gpt-image-1。提案動画→Higgsfield |

## 🎬 Video Bake-Off モード（複数モデル比較）

「**Veo・Kling・Seedanceで回して一番良いの見せて**」と言われたら、
`scripts/video-bake-off.sh` を使う：

```bash
./scripts/video-bake-off.sh "シーン説明プロンプト" [出力ディレクトリ]
```

動作:
1. 3モデル（`veo3_1` / `kling3_0` / `seedance_2_0`）に**同時ジョブ投入**
2. 並列で完成待ち（最大20分）
3. 完成順にURL表示＋ローカルmp4保存
4. 人間が比較してベストを選ぶ

**使用判断:**
| シチュエーション | 推奨 |
|---|---|
| 重要シーン・コンセプト確定前 | Bake-Off 推奨（3モデル比較） |
| 大量バッチ生成 | 単一モデル（コスト最適） |
| 残クレジット少ない | 単一モデル（Seedance 2.0 が標準） |

**クレジット概算:**
- Bake-Off 1回 ≒ 3モデル分のクレジット消費
- 事前に `higgsfield account status` で残量確認必須

## 使用可能な動画モデル一覧（Higgsfield）

| モデルID | 名称 | 強み |
|---|---|---|
| `veo3_1` | Google Veo 3.1 | 最新・最高品質・物理表現 |
| `veo3_1_lite` | Veo 3.1 Lite | 高速・低コスト |
| `veo3` | Veo 3 | 安定版 |
| `kling3_0` | Kling 3.0 | キャラ動き・表情に強い |
| `kling3_0_turbo` | Kling 3.0 Turbo | 高速版 |
| `kling3_0_motion_control` | Kling Motion Control | カメラワーク指定可 |
| `seedance_2_0` | Seedance 2.0 | バランス型・標準 |
| `seedance1_5` | Seedance 1.5 Pro | 安定版 |
| `grok_video_v15` | Grok Video 1.5 | xAI製 |
| `cinematic_studio_video_3_5` | Cinematic Studio 3.5 | シネマティック演出 |

完全リスト: `higgsfield model list`

## クレジット管理（Higgsfield Plus 前提）

| カテゴリ | 状態 |
|---|---|
| **無制限モデル**（gpt_image / flux_2_pro / seedream / nano_banana / seedance_2_0 高速版 等） | クレジット消費**ゼロ**、気にせず使ってよい |
| **クレジット消費モデル**（Veo 3.1 / Kling 3.0 / Nano Banana 2 Pro 等） | 月1200クレジット消費、要管理 |

**確認:**
```bash
higgsfield account status         # 残クレジット
higgsfield model list              # 全モデルと種別
```

**運用ルール:**
- 大量バッチ・量産は**無制限モデルで回す**
- Veo / Kling 3.0 は重要シーン・比較時のみ
- 月末にクレジット残量を確認し、未使用なら積極消費（次月持ち越し不可）

## 認証情報の置き場所

- **Higgsfield**: `higgsfield auth login` でCLI内に保存（ファイル管理不要）
- **Runway**: MCP接続で OAuth 済
- ~~OpenAI / fal.ai~~: 現在は不使用（`.env` の旧キーは保管のみ）

## 禁則

- 認証情報をコードや log に出力しない
- 残量を気にせず大量バッチを回さない（部署 CxO 経由で承認）
- 生成物のライセンスはサービスごとに違う → 商用利用前に各サービスの利用規約を確認
- 著名人・既存キャラの似顔絵は生成しない（権利侵害リスク）

## 関連

- 資料デザイン: `feedback_deck_design.md`
- エラー記憶: `error-memory.md`
- LP業種別パターン: `~/.claude/skills/lp-industry-patterns/`
