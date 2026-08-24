<p align="right"><a href="README.md">English</a> / <strong>日本語</strong></p>

<h1 align="center">🧭 semantic-diff-tracer</h1>

<p align="center"><b>VSCode / ターミナル向け「story mode」PR レビュー支援ツール</b></p>

> [!WARNING]
> 実験的な実装です。インターフェース、コマンド、プロンプトはまだ流動的です。

semantic-diff-tracer は、レビュアーが差分を 1 行ずつ読み始める前に GitHub PR の全体像を掴むための VSCode extension および同じコアを共有する TUI CLI です。変更 hunk を outcome ベースの **観点 (perspective)** にまとめ、観点ごとに視覚化つきサマリを提示し、コードを **実行せずに story として辿る** ことができます（Step In / Over / Out / Back）。

## なぜ semantic-diff-tracer？

- **Outcome ベースの観点** — hunk を「マージ後に何ができるようになったか」でグループ化。ファイルパスでもコミット順でもない
- **自動 mock によるセマンティックなトレース** — block tree を事前に計画するとともに I/O 境界（HTTP、filesystem、DB、clock、randomness）を自動で stub 化するため、debug adapter も実行系もなしに、変更を story として step できる。任意の mock を自然言語で書き換える（例: `"what if the token is expired?"`）と downstream の flow が再計画される
- **任意の場所に質問できる** — Summary / Trace の任意テキストをドラッグ選択 → 質問 → 回答が Q&A セクションとして観点に紐付く
- **VSCode でもターミナルでも同じ体験** — extension と TUI CLI が同じ core を共有するので、表示される観点・サマリ・トレースは両方の環境で同一

## 🚀 クイックスタート

### 1. 要件

- Node.js 20+
- VSCode 1.90+（extension を使う場合）
- Git 2.20+
- GitHub アカウント（VSCode 組み込みの `github` auth provider が OAuth を処理。PAT 不要）
- LLM バックエンドの資格情報。同梱される adapter は現在 Claude のみで、`claude` CLI での OAuth ログインか、`ANTHROPIC_API_KEY` / Vertex / Bedrock いずれかの構成を受け付けます

### 2. インストール

VSCode Marketplace 未公開。ソースからビルドしてください。

```bash
git clone https://github.com/amaya382/semantic-diff-tracer.git
cd semantic-diff-tracer
npm install
npm run build
```

生成された `.vsix` をインストール:

```bash
npm run package:vscode
code --install-extension apps/vscode/semantic-diff-tracer-0.0.1.vsix
```

もしくは、VSCode で本リポジトリを開いて F5 で Extension Development Host を起動。

### 3. PR を開く

```
コマンドパレット (Ctrl/Cmd+Shift+P)
  → Semantic Diff Tracer: Open PR (URL / #N / branch)
```

`https://github.com/owner/repo/pull/42`、`owner/repo#42`、GitHub remote が設定済みなら `#42` 単体、あるいはローカルブランチ名を貼り付け。現在のブランチを `main` と比較したい場合は:

```
コマンドパレット → Semantic Diff Tracer: Review Current Branch
```

**Semantic Diff Tracer** アクティビティバーに観点が並びます。観点をクリックすると Summary / Trace パネルが開きます。

## 📖 使い方

semantic-diff-tracer は PR を 3 段階で処理し、それぞれ LLM の conversation が 1 本立ちます。

1. **観点抽出** — PR ごとに 1 conversation、diff を注入。`{ tldr, perspectives[], incidental[] }` を返す。
2. **Summary 生成** — 観点ごとに、PR conversation から fork。`{ outcome, watchFor[], tests[], visualization }` を返し、flow の warmup も行う。
3. **Flow 計画** — 観点ごとに独立した conversation。レビュアーが Trace タブで歩く **block tree** を返す。

conversation は PR ref をキーに extension のグローバルストレージ配下の `sessions.json` に永続化されます。PR を再度開くと LLM を再消費せず state を復元します。「conversation を fork する」がプロバイダの native 機能かメッセージ列の複製で emulate されているかは adapter の関心事で、パイプラインからは見えません（Claude backend では前者）。

### 観点抽出

観点はファイルグループではなく **outcome** です。抽出プロンプト（[`packages/core/src/prompts/perspective.ts`](packages/core/src/prompts/perspective.ts) に埋め込み）が以下のルールを強制します。

- レビュアーが実際に考える軸で diff を切る（例: 「SSO login が動くようになった」「キャッシュ無効化の刷新」）
- 純粋に機械的な変更（rename、フォーマット）は、それが奉仕する観点に折り込む。奉仕先がなければ "Incidental changes" に降格
- テスト、ドキュメント、fixture は、それが検証・説明する観点に属させる
- 50% 以上のファイルを共有する候補はマージ
- 並び順はレビュー判断上の重要度順。パス順でもコミット順でもない

### Summary タブ

観点をクリックすると 2 タブのパネルが開きます。**Summary** タブに載る要素:

- **Outcome** — 何ができるようになったかを 1 行で
- **Watch for** — 気を配るべき微妙な不変条件・契約変更
- **Tests** — この観点を検証するファイル。各行がクリック可能な `file:line` チップ
- **Visualization** — 変更の性質に合った図解。`mermaid`（sequence / flowchart / state）、`call-tree`、`component-tree`、`file-tree`、`pseudocode`、あるいは `diff` ブロックから選ぶ。選択規則は [show-me skill](https://github.com/anthropics/claude-code/blob/main/skills/show-me/SKILL.md) の「内容形状 → 形式」マッピングと同じ
- **Q&A** — 任意テキストをドラッグ選択して質問。回答はセクションとして pin される。任意のセクションに follow-up 可能、不要になったら削除

### Trace タブ

**Trace** タブは同じ観点を block tree の stepper で見せます。

- **Step In / Over / Out / Back** — tree のカーソルを動かす。各 block は focus range と短いナラティブを持つ
- **Focus range** — after 側のファイルの該当行がコードパネルでハイライトされる。既存コードを変えた block は before 側も表示可能
- **Mocks** — plan が stub 化した I/O（HTTP、filesystem、DB、clock、randomness）をインライン一覧
- **Mock から refine** — mock への変更を自然言語で指示（例: `"what if the token is expired?"`）。`refineFlowFromMock` が downstream tree を再計画

debug adapter も実行系もありません。block tree は 1 度計画されて client 側で解釈するだけです。step ごとの LLM コストは mock refine のみ発生します。

### 選択範囲について質問する

いずれのタブでもテキスト選択後に **Ask about selection**。質問・選択テキスト・（取れれば）出典の `file:line` が `askQa` に送られ、対象観点の summary / flow セッションを fork した上で `QaSection` が返ります。セクションは Summary タブに積まれ、パネルを閉じ再度開いても残ります。

## ⌘ コマンド一覧

コマンドはすべてコマンドパレット上の `Semantic Diff Tracer:` プレフィックス配下にあります。

| コマンド                      | 内容                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Open PR (URL / #N / branch)` | GitHub PR（URL、`owner/repo#N`、remote 設定済みなら `#N`）またはローカルブランチをロードして観点を抽出       |
| `Review Current Branch`       | 現在のブランチを `sdt.defaultBaseBranch`（既定 `main`）と diff                                               |
| `Refresh Perspectives`        | 現在の PR のキャッシュセッションを破棄して再抽出                                                             |
| `Open Summary`                | 選択した観点の Summary タブを開く                                                                            |
| `Open Trace`                  | 選択した観点の Trace タブを開く                                                                              |
| `Switch Baretree Worktree`    | [baretree](https://github.com/amaya382/baretree) root で開いているときに、レビュー対象の worktree を選び直す |
| `Cleanup PR Checkouts`        | `<repo>/.sdt/pr-N` 配下に作られた GitHub PR checkout を削除                                                  |
| `Show Log`                    | "Semantic Diff Tracer" output channel を表示                                                                 |

## ⚙️ 設定

`Settings → Extensions → Semantic Diff Tracer`、または `settings.json`。

### パイプライン

| 設定                    | 既定値 | 説明                                                                                                                                         |
| ----------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `sdt.defaultBaseBranch` | `main` | `Review Current Branch` で使う base ブランチ                                                                                                 |
| `sdt.language`          | `en`   | すべての LLM prompt の末尾に付ける自由記述の language hint（`en`、`ja`、`zh`、`Español` など）。summary、flow のナラティブ、Q&A の回答に効く |
| `sdt.flowMaxTurns`      | `20`   | Flow 計画・refine の agent turn 上限。agent loop を持たない adapter は無視します                                                             |

### LLM バックエンド — Claude adapter

パイプラインは `LlmProvider` port と対話します。同梱される adapter は現状 Claude のみで、以下の設定はすべて Claude 固有です。別の adapter が追加された場合はそれ自身の設定を持ちます。

| 設定                       | 既定値   | 説明                                                                                                                                                                              |
| -------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sdt.claudeExecutable`     | `""`     | `claude` CLI の絶対パス。空文字なら `PATH` と Claude Code の標準インストール場所を探索                                                                                            |
| `sdt.environmentVariables` | `[]`     | spawn した Claude CLI に追加で渡す環境変数。`{ "name": "VAR", "value": "..." }` のリストで指定し、extension host の env にマージ（設定が優先）。詳細は下の「Claude 資格情報」参照 |
| `sdt.claudeModel`          | `sonnet` | `default` / `sonnet` / `opus` / `haiku` / `inherit`。`default` は SDK/CLI 既定、`inherit` は環境の `claude` CLI 設定に追従                                                        |
| `sdt.claudeEffort`         | `low`    | `maxThinkingTokens` にマップされる推論予算: `default`（明示的上限なし）、`low` (1024)、`medium` (4096)、`high` (16384)、`max` (32768)                                             |

設定変更は次の `Open PR` / `Refresh` から反映されます（window reload 不要）。

**env による上書き**: `SDT_CLAUDE_MODEL` / `SDT_CLAUDE_EFFORT` / `SDT_LANGUAGE` / `SDT_CLAUDE_EXECUTABLE` を extension host プロセスに渡すと、対応する設定を上書きします。同梱の `.vscode/launch.json` はこれで dev host を `sonnet` + `low` に pin していて、開発者個人の設定に触れずに済みます。

### Claude 資格情報

spawn した CLI は SDK の isolation mode (`settingSources: []`) で走ります。したがって `~/.claude/settings.json`、そこに書かれた hooks、`enabledPlugins`、`~/.claude/CLAUDE.md` は child プロセスに到達しません。OAuth ログインは引き続き動作します — `~/.claude/.credentials.json` は独立に読み込まれます。

通常 `~/.claude/settings.json` に置く provider 資格情報は env 経由で渡す必要があります。

- **VSCode**: `sdt.environmentVariables` にセット。例: `[{ "name": "CLAUDE_CODE_USE_VERTEX", "value": "1" }, { "name": "ANTHROPIC_VERTEX_PROJECT_ID", "value": "..." }]`。`apiKeyHelper` と `settings.json` の `env` ブロックは効きません — 値を直接ここに置いてください
- **TUI**: shell で export してから起動。child に継承されます

## 🖥️ TUI

> [!WARNING]
> TUI はまだ未実装です。`apps/tui` は最小の readline REPL scaffold を持つのみで、上で説明した観点リスト・Summary ビュー・Trace stepper は現時点で VSCode 限定です。

```bash
npm run build
node apps/tui/dist/main.js <URL | owner/repo#N | #N | branch>
```

環境変数（`SDT_CLAUDE_*` は Claude adapter — 現状唯一の LLM バックエンド — に属します）:

| 変数                        | 説明                                                                      |
| --------------------------- | ------------------------------------------------------------------------- |
| `SDT_LANGUAGE`              | 自由記述の language hint（既定 `en`）                                     |
| `SDT_CLAUDE_MODEL`          | `sonnet` / `opus` / `haiku` / `inherit` / full model id（既定: SDK 既定） |
| `SDT_CLAUDE_EFFORT`         | `low` / `medium` / `high` / `max`（既定: SDK 既定）                       |
| `SDT_CLAUDE_EXECUTABLE`     | `claude` CLI の絶対パス（既定: `PATH` から解決）                          |
| `GITHUB_TOKEN` / `GH_TOKEN` | GitHub 資格情報。ターミナルには VSCode の auth provider がないので必要    |

## 🧪 開発

```bash
npm install
npm run build                     # 全 workspace をビルド
npm test                          # packages/* に対する vitest
npm run check:boundaries          # core が vscode / ターミナル UI を import しないことを強制
npm run package:vscode            # apps/vscode/semantic-diff-tracer-*.vsix を生成
```

Extension Development Host:

```bash
code .            # または `code apps/vscode`
# F5 → "Run Extension" 系のいずれかを選択
```

`apps/vscode/.vscode/launch.json` にはフォルダ選択方法違いの構成がいくつか入っています（起動ごとにパスを聞く / フォルダなしで起動 / 本リポジトリ自体を開いて dogfood）。保存時に extension bundle を再ビルドするには:

```bash
npm run watch -w apps/vscode
```

## 🔧 トラブルシューティング

### "Semantic Diff Tracer: no PR loaded yet"

先に `Semantic Diff Tracer: Open PR (URL / #N / branch)` または `Review Current Branch` を実行してください。すべてのパネル・コマンドは PR がロード済みであることを前提とします。

### GitHub sign-in loop

VSCode の `github` auth provider は初回に OAuth device flow を使います。止まったら通知エリアからブラウザ手順を進めてください。リセットするには `GitHub: Sign Out` をコマンドパレットで実行してからやり直します。

### Trace タブが空

Flow 計画は観点を初めて開いたときに走り、数 LLM turn かかることがあります。ステータスバーのスピナーと `Semantic Diff Tracer` output channel（`Semantic Diff Tracer: Show Log`）を確認してください。計画エラーはそこにログが出ます。

### "Claude CLI not found"

extension は `PATH` と Claude Code の標準インストール場所を探します。`claude` バイナリが別の場所にある場合は、`sdt.claudeExecutable` に絶対パスを指定してください（TUI では `SDT_CLAUDE_EXECUTABLE`）。

### provider の認証エラー（Vertex / Bedrock / API key）

`~/.claude/settings.json` は読み込まれません（isolation mode のため）。VSCode では provider の env を `sdt.environmentVariables` に、TUI では shell で export してください。`apiKeyHelper` は効きません — 値を直接指定します。

## 🙏 謝辞

- [show-me skill](https://github.com/anthropics/claude-code/blob/main/skills/show-me/SKILL.md) — Summary タブが再利用する「内容形状 → 可視化」マッピング（mermaid / call-tree / component-tree / file-tree / pseudocode / diff）
