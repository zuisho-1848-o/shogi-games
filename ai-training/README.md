# ai-training

トラックB Stage B: やねうら王のNNUE評価関数(halfkp_512x2-16-32アーキテクチャ)を自前で学習させるためのPython環境。
詳細な設計・検証結果はdocs/AI_ROADMAP.mdを参照。

## セットアップ

```bash
cd ai-training
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## ファイル

- `nnue_format.py`: BonaPiece(駒種+位置のエンコーディング)の定義と、盤面→特徴量indexへの変換関数。
- `export_nnue.py`: numpy配列(重み)をやねうら王が読めるバイナリ(`nn.bin`)形式で書き出す。

## 動作確認済みのこと

全結合をゼロ初期化した`nn.bin`を書き出し、`vendor/bin-nnue/yaneuraou-nnue`(YANEURAOU_ENGINE_NNUE_HALFKP_512X2_16_32エディションでビルド)が
これを実際に読み込み、クラッシュせずに指し手を返すことを確認済み(ファイル形式・レイヤーサイズが正しいことの証明)。
`nnue_format.py`の特徴量エンコード関数についても、標準初期局面で先手・後手それぞれ38個(玉を除く全駒)の
重複のないindexが正しい範囲内で生成されることを確認済み。

まだ実際の学習(重みを意味のある値にする)は行っていない。次のステップは学習データパイプラインの構築。
