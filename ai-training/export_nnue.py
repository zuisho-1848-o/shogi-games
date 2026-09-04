"""
PyTorchのモデル(重み)をやねうら王のNNUE(halfkp_512x2-16-32)バイナリ形式で書き出す。
まずは「読み込めるか」を検証するためのゼロ初期化スモークテスト用に、numpy配列を直接渡す形にしてある
(学習後はモデルの重みテンソルをnumpyに変換して同じ関数に渡せばよい)。
"""

import struct
import numpy as np
from nnue_format import (
    VERSION,
    ARCHITECTURE_STRING,
    HALF_DIMENSIONS,
    RAW_FEATURE_DIMENSIONS,
    HIDDEN1_IN_PADDED,
    HIDDEN1_OUT,
    HIDDEN2_IN_PADDED,
    HIDDEN2_OUT,
    OUTPUT_IN_PADDED,
    OUTPUT_OUT,
)

# ハッシュ値は不一致でも警告が出るだけで読み込みは継続されることをソースで確認済みなので、
# ここではダミー値を使う(将来、正確な値を計算して埋めても良いが必須ではない)。
DUMMY_HASH = 0x00000000


def write_u32(f, value: int):
    f.write(struct.pack("<I", value))


def write_header(f):
    write_u32(f, VERSION)
    write_u32(f, DUMMY_HASH)
    arch_bytes = ARCHITECTURE_STRING.encode("utf-8")
    write_u32(f, len(arch_bytes))
    f.write(arch_bytes)


def write_feature_transformer(f, biases: np.ndarray, weights: np.ndarray):
    """biases: shape (512,) int16
    weights: shape (125388, 512) int16 = (入力特徴量, 出力=隠れユニット)
    ※ 通常のnn.Linear(in,out).weightは(out,in)の並びだが、NNUEの特徴変換層は
      「1つの特徴量が立った時にaccumulation[0:512]へ丸ごと加算する」というスパース更新に
      最適化された転置レイアウト(feature-major, weights_[kHalfDimensions*feature_index + j])
      になっている。nnue_feature_transformer.hのアクセスパターン(weights_[kHalfDimensions*index+tile_offset]、
      accumulation[j] += weights_[offset+j])で確認済み。PyTorch側の重み(out,in)=(512,125388)は
      呼び出し側で.T(転置)してから渡すこと。"""
    assert biases.shape == (HALF_DIMENSIONS,)
    assert weights.shape == (RAW_FEATURE_DIMENSIONS, HALF_DIMENSIONS)
    write_u32(f, DUMMY_HASH)
    f.write(biases.astype("<i2").tobytes())
    f.write(weights.astype("<i2").tobytes())


def export(path: str, ft_biases, ft_weights, h1_biases, h1_weights, h2_biases, h2_weights, out_biases, out_weights):
    with open(path, "wb") as f:
        write_header(f)
        write_feature_transformer(f, ft_biases, ft_weights)
        # Networkブロック全体で1つのhash + 各層の中身(ClippedReLUはパラメータなしなので何も書かない)
        write_u32(f, DUMMY_HASH)
        _write_affine_body(f, h1_biases, h1_weights, HIDDEN1_OUT, HIDDEN1_IN_PADDED, h1_weights.shape[1])
        _write_affine_body(f, h2_biases, h2_weights, HIDDEN2_OUT, HIDDEN2_IN_PADDED, h2_weights.shape[1])
        _write_affine_body(f, out_biases, out_weights, OUTPUT_OUT, OUTPUT_IN_PADDED, out_weights.shape[1])


def _write_affine_body(f, biases, weights, out_dim, in_dim_padded, in_dim_real):
    """Networkブロック内の各AffineTransform層は(前段のWriteParametersが先に呼ばれる形で)
    ネストして書き込まれるが、中身は結局「biases + weights」の単純な連結になる(層ごとのhashは
    Networkブロック全体で1個だけなので、ここでは付けない)。"""
    padded = np.zeros((out_dim, in_dim_padded), dtype=np.int8)
    padded[:, :in_dim_real] = weights.astype(np.int8)
    f.write(biases.astype("<i4").tobytes())
    f.write(padded.tobytes())


if __name__ == "__main__":
    import sys
    from nnue_format import RAW_FEATURE_DIMENSIONS as RFD, HALF_DIMENSIONS as HD, HIDDEN1_OUT as H1O, HIDDEN2_OUT as H2O

    out_path = sys.argv[1] if len(sys.argv) > 1 else "smoke_test.bin"

    # スモークテスト: 全結合をゼロ初期化(バイアスも0)。読み込めるか・クラッシュしないかだけを見る。
    ft_biases = np.zeros((HD,), dtype=np.int16)
    ft_weights = np.zeros((RFD, HD), dtype=np.int16)
    h1_biases = np.zeros((H1O,), dtype=np.int32)
    h1_weights = np.zeros((H1O, HD * 2), dtype=np.int8)
    h2_biases = np.zeros((H2O,), dtype=np.int32)
    h2_weights = np.zeros((H2O, H1O), dtype=np.int8)
    out_biases = np.zeros((1,), dtype=np.int32)
    out_weights = np.zeros((1, H2O), dtype=np.int8)

    export(out_path, ft_biases, ft_weights, h1_biases, h1_weights, h2_biases, h2_weights, out_biases, out_weights)
    print(f"wrote {out_path}")
