# 00-rules/security-tax.md — 自走ループのセキュリティ税

> 無人で走るループは、無人で走る攻撃面でもある。

## 脅威モデル

| 脅威 | 工場での起こり方 |
|---|---|
| **未レビューのまま PR がマージされる** | yt-uploader / agency 系の「人間承認後のみ送信」原則が緩むと事故 |
| **Skill経由のプロンプトインジェクション** | 公開された skill を無監査で自動 install すると、その description にコマンド注入があれば乗っ取られる |
| **ログにシークレット流出** | デバッグログで `.env` の値が見える状態で動き続ける |
| **権限スコープの肥大化** | 「便利だから write 権限追加」を繰り返し、再監査されないまま放置 |

## 工場の既存ガード

| ガード | 状態 |
|---|---|
| `.env` / `secrets/` 絶対禁止 | ✅ 全エージェント・両 CLI に明記 |
| `git push --force` / `rm -rf` 禁止 | ✅ グローバル CLAUDE.md に明記 |
| pre-commit フックでシークレットブロック | ✅ グローバル設定済み |
| 不可逆操作は人間承認 | ✅ 全部署 `_RULE.md` に明記 |
| Codex deny_paths | ✅ `~/.codex/config.toml` で `.env` 等を deny |

## 追加すべきガード（新規）

### 1. Skill の自動 install 禁止

> 17,022 skills のうち 520 がクレデンシャル漏洩を起こした実測値あり。

ルール:
- `npx skills add` は **必ず人間が手動実行**（loop で自動 install しない）
- install 前に skill の `SKILL.md` を Read してプロンプトインジェクションがないか確認
- 信頼できる作者・組織のみ（anthropic-skills / 既知のメーカー公式）
- 不明な作者からの skill は `~/.claude/skills/` ではなく `decks/<project>/scratch/` で試験

### 2. Verbose ログを本番ループで無効化

- production loop（07-routines/ 配下）では `--verbose` / `DEBUG=true` 禁止
- ログ出力時は必ず secret マスキング:
  ```python
  # NG
  print(f"API call with key={api_key}")
  # OK
  print(f"API call with key={api_key[:4]}***")
  ```

### 3. 権限スコープの月次再監査

毎月1日に以下を点検（PDCA-strategist の月次タスクに組み込み）:

```bash
# 各エージェント定義の tools フィールドを確認
grep -A1 "^tools:" .claude/agents/*.md | sort -u

# 「いつのまにか Edit / Bash が増えていないか」
```

判定:
- レビュー系（*-reviewer / *-qa / message-reviewer / pdca-proposer）に **Edit / Write が付いていたら即削除**
- 「便利だから」で増えた権限は **使われていなければ削除**
- 増えた理由が必要なら `_RULE.md` に Why を明文化

### 4. ループ実行前のセキュリティチェック PR ゲート

ループが PR を生成する場合、merge 前に以下が全部通っていることを必須:

| チェック | ツール |
|---|---|
| SAST | semgrep / Codex security review |
| 依存監査 | npm audit / pip-audit |
| シークレットスキャン | gitleaks / pre-commit |
| 機密パス変更検知 | `.env` / `secrets/` / `*.key` / `id_rsa` のいずれかが diff にあったら拒否 |

### 5. ループの kill switch

各 loop に以下を明記:

```yaml
# 07-routines/<loop-name>/config.yaml
kill_switch:
  max_iterations: 10            # ハードストップ
  max_tokens_per_run: 100000    # トークン上限
  max_wallclock_minutes: 30     # 時間上限
  abort_on_error: true          # エラー時即停止
  notify_on_abort:
    - human: abe@growth-navi.com
```

これがないループは「上限なし」と同義 = 永遠に金を吸う。

### 6. 30日ごとの権限再監査

毎月1日: pdca-strategist が以下を実行:

```bash
# 直近30日で追加された権限を抽出
git log --since="30 days ago" --diff-filter=AM -p .claude/agents/ \
  | grep -A2 "^+tools:"
```

不要なものは削除、必要なものは `_RULE.md` に追加理由を記録。

---

## 違反時のエスカレーション

| 違反 | 対応 |
|---|---|
| ループが自動で skill install した | 即停止 + 人間調査 |
| ログにシークレットが出力された | キー即ローテーション + ログ削除 |
| 不可逆操作が人間承認なしに実行された | ループ停止 + post-mortem |
| pre-commit フックを `--no-verify` で迂回した | 全コミット監査 + 該当エージェント権限剥奪 |

---

## 関連

- ループ判定: [loop-eligibility.md](loop-eligibility.md)
- ドリフト検知: [drift-detection.md](drift-detection.md)
- エラー記憶: [error-memory.md](error-memory.md)
- comprehension debt: [comprehension-debt.md](comprehension-debt.md)
- Codex設定: [codex-config.md](codex-config.md)
