"""
halfkp_512x2-16-32アーキテクチャのNNUE評価関数を学習する。

ネットワーク構造(vendor/YaneuraOu/source/eval/nnue/を読んで確認済み):
  feature_transformer(共有の埋め込み層、HalfKP特徴量→512次元、先後2視点分)
  -> concat([own, opp]) (1024次元) -> clamp(0,127)
  -> Linear(1024->16) -> clamp(0,127)
  -> Linear(16->32) -> clamp(0,127)
  -> Linear(32->1)  (これが生の評価値。学習時はsigmoid(out/SCALE)で勝率に変換して教師信号と比較する)

学習の教師信号はDBの自己対局結果(勝敗)。将来的にはやねうら王自身の探索評価値を教師にする
(いわゆるteacher-student方式)ほうが精度が上がると思われるが、まずは既存のTexelチューニング
(apps/server/src/ai/tuning.ts)と同じ「対局結果を使う」方式で学習パイプライン全体を通す。
"""

import sys
import torch
import torch.nn as nn
from torch.utils.data import DataLoader

from dataset import load_jsonl, NnueDataset, collate
from nnue_format import HALF_DIMENSIONS, RAW_FEATURE_DIMENSIONS, HIDDEN1_OUT, HIDDEN2_OUT
from export_nnue import export

SCALE = 400.0  # apps/server/src/ai/tuning.tsのsigmoidスケールと合わせる


class NnueModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.feature_transformer = nn.EmbeddingBag(RAW_FEATURE_DIMENSIONS, HALF_DIMENSIONS, mode="sum")
        self.ft_bias = nn.Parameter(torch.zeros(HALF_DIMENSIONS))
        nn.init.uniform_(self.feature_transformer.weight, -0.01, 0.01)

        self.hidden1 = nn.Linear(HALF_DIMENSIONS * 2, HIDDEN1_OUT)
        self.hidden2 = nn.Linear(HIDDEN1_OUT, HIDDEN2_OUT)
        self.output = nn.Linear(HIDDEN2_OUT, 1)

    def forward(self, own_flat, own_offsets, opp_flat, opp_offsets):
        own_acc = self.feature_transformer(own_flat, own_offsets) + self.ft_bias
        opp_acc = self.feature_transformer(opp_flat, opp_offsets) + self.ft_bias
        x = torch.clamp(torch.cat([own_acc, opp_acc], dim=1), 0, 127)
        x = torch.clamp(self.hidden1(x), 0, 127)
        x = torch.clamp(self.hidden2(x), 0, 127)
        return self.output(x).squeeze(-1)


def train(data_path: str, out_bin_path: str, epochs: int = 20, batch_size: int = 256, lr: float = 1e-3):
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"device: {device}")

    samples = load_jsonl(data_path)
    print(f"loaded {len(samples)} positions")
    if len(samples) < 100:
        print("WARNING: 学習データが少なすぎる可能性があります(目安: 最低でも数千局面)")

    dataset = NnueDataset(samples)
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True, collate_fn=collate)

    model = NnueModel().to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)

    for epoch in range(epochs):
        total_loss = 0.0
        n = 0
        for own_flat, own_off, opp_flat, opp_off, outcomes in loader:
            own_flat, own_off = own_flat.to(device), own_off.to(device)
            opp_flat, opp_off = opp_flat.to(device), opp_off.to(device)
            outcomes = outcomes.to(device)

            pred_raw = model(own_flat, own_off, opp_flat, opp_off)
            pred_prob = torch.sigmoid(pred_raw / SCALE)
            loss = nn.functional.mse_loss(pred_prob, outcomes)

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            total_loss += loss.item() * len(outcomes)
            n += len(outcomes)
        print(f"epoch {epoch + 1}/{epochs}: MSE={total_loss / n:.5f}")

    export_model(model, out_bin_path)
    print(f"exported {out_bin_path}")


AFFINE_WEIGHT_SCALE = 64  # kWeightScaleBits=6 (nnue_common.h) -> 2^6。C++側はaffine層の出力を必ずこの値で右シフトする固定スケールなので、量子化側もこれに合わせる必要がある(動的スケールにしてはいけない)。


def export_model(model: NnueModel, out_path: str):
    """floatで学習した重みを、やねうら王のC++側が前提とする固定スケールで量子化して書き出す。

    - feature_transformer: 学習時点でclamp(0,127)という実機と同じ範囲でクリップして訓練しているため、
      重み・バイアスは追加のスケーリング無しでそのままint16に丸めればよい(動的な正規化をしてしまうと、
      C++側のクリップ範囲[0,127]と学習時の値のスケールがズレて壊れる)。
    - hidden1/hidden2/output: C++側はaffine層の出力を必ず2^6(kWeightScaleBits)で右シフトする固定仕様
      (nnue_common.h)なので、重みはfloat*64を丸めてint8に、バイアスはfloat*64を丸めてint32にする
      (動的スケールにすると、シフト量が固定のC++側と数値の意味が食い違ってしまう)。
    まだquantization-aware training(学習中に量子化誤差を考慮する手法)はしていないので、
    値の範囲によっては丸め誤差・クリップによる精度劣化が大きい可能性がある。"""
    model.eval()
    with torch.no_grad():
        ft_w = model.feature_transformer.weight.cpu().numpy()  # (RAW_FEATURE_DIMENSIONS, HALF_DIMENSIONS)
        ft_b = model.ft_bias.cpu().numpy()
        ft_w_q = ft_w.round().clip(-32768, 32767).astype("int16")
        ft_b_q = ft_b.round().clip(-32768, 32767).astype("int16")

        def quantize_affine(layer: nn.Linear):
            w = layer.weight.detach().cpu().numpy()  # (out, in)
            b = layer.bias.detach().cpu().numpy()
            w_q = (w * AFFINE_WEIGHT_SCALE).round().clip(-128, 127).astype("int8")
            b_q = (b * AFFINE_WEIGHT_SCALE).round().clip(-(2**31), 2**31 - 1).astype("int32")
            return w_q, b_q

        h1_w, h1_b = quantize_affine(model.hidden1)
        h2_w, h2_b = quantize_affine(model.hidden2)
        out_w, out_b = quantize_affine(model.output)

        export(out_path, ft_b_q, ft_w_q, h1_b, h1_w, h2_b, h2_w, out_b, out_w)


if __name__ == "__main__":
    data_path = sys.argv[1] if len(sys.argv) > 1 else "data/positions.jsonl"
    out_path = sys.argv[2] if len(sys.argv) > 2 else "data/trained_nn.bin"
    epochs = int(sys.argv[3]) if len(sys.argv) > 3 else 20
    train(data_path, out_path, epochs=epochs)
