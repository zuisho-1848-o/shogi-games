"""
やねうら王のNNUE評価関数ファイル(halfkp_512x2-16-32アーキテクチャ)のバイナリ形式。

ソース(vendor/YaneuraOu/source/eval/nnue/)を直接読んで確認した仕様:
- ヘッダ: version(u32 LE, 固定値0x7AF32F16) + hash_value(u32 LE) + arch_size(u32 LE) + arch文字列
  hash_valueの不一致は起動時に警告が出るだけで読み込み自体は続行される(致命的ではない)ことを確認済み。
- FeatureTransformer: [hash u32] + biases(int16 x 512) + weights(int16 x 512*125388)
  (kInputDimensions = SQ_NB(81) * fe_end(1548) = 125388)
- Network(1スタックのみ、kLayerStacks=1): [hash u32] に続けて、入力側から出力側の順で各層のbias+weight
  - HiddenLayer1 (AffineTransformSparseInput, 1024→16): bias(int32 x16) + weight(int8 x 16*1024)
  - HiddenLayer2 (AffineTransform, 16→32): bias(int32 x32) + weight(int8 x 32*32)  ※入力側は32にパディングされる(kMaxSimdWidth=32)
  - OutputLayer  (AffineTransform, 32→1):  bias(int32 x1)  + weight(int8 x 1*32)
  ClippedReLU層自体はパラメータを持たない(前段に委譲するだけ)。
  重みのスクランブル(GetWeightIndexScrambled)は USE_SSSE3 または USE_NEON>=8/USE_NEON_DOTPROD の時だけ有効。
  今回のmacOS/Apple Siliconビルド(-DUSE_NEON、値なし=1相当)ではどちらの条件にも合致しないため、
  重みは単純な行優先(row-major)の並びで書き込めばよいことを確認済み。

BonaPiece(駒種+盤面/持ち駒の位置を表す一意な番号)は Bonanza/Apery 由来の標準的な定義
(vendor/YaneuraOu/source/evaluate.h の BonaPiece enum)をそのまま転記した。
DISTINGUISH_GOLDS は本ビルドでは無効(config.hでコメントアウト)なので、と金・成香・成桂・成銀は
金と同じBonaPieceスロットを共有する。
"""

from dataclasses import dataclass

SQ_NB = 81

# --- 持ち駒(手駒)のBonaPieceオフセットと最大枚数 ---
HAND_OFFSETS = {
    # kind -> (f_offset, e_offset, max_count)
    "pawn": (1, 20, 18),
    "lance": (39, 44, 4),
    "knight": (49, 54, 4),
    "silver": (59, 64, 4),
    "gold": (69, 74, 4),
    "bishop": (79, 82, 2),
    "rook": (85, 88, 2),
}
FE_HAND_END = 90

# --- 盤上の駒のBonaPieceオフセット(各81マス分) ---
# DISTINGUISH_GOLDS無効なので、成り駒は金と同じスロットを共有する。
BOARD_KIND_TO_KEY = {
    "pawn": "pawn",
    "lance": "lance",
    "knight": "knight",
    "silver": "silver",
    "gold": "gold",
    "bishop": "bishop",
    "rook": "rook",
    # 成り駒
    "tokin": "gold",
    "promoted_lance": "gold",
    "promoted_knight": "gold",
    "promoted_silver": "gold",
    "horse": "horse",  # 成角(馬)は独立スロット
    "dragon": "dragon",  # 成飛(龍)は独立スロット
}
BOARD_KEY_ORDER = ["pawn", "lance", "knight", "silver", "gold", "bishop", "horse", "rook", "dragon"]
BOARD_OFFSETS = {key: (FE_HAND_END + i * 2 * SQ_NB, FE_HAND_END + (i * 2 + 1) * SQ_NB) for i, key in enumerate(BOARD_KEY_ORDER)}
# 例: pawn -> (f_pawn=90, e_pawn=171), lance -> (f_lance=252, e_lance=333), ...

FE_END = FE_HAND_END + len(BOARD_KEY_ORDER) * 2 * SQ_NB  # 90 + 9*2*81 = 1548


def opponent_of(owner: str) -> str:
    return "gote" if owner == "sente" else "sente"


def yaneura_square(row: int, col: int) -> int:
    """内部座標(row,col: 0始まり)をやねうら王のSquare番号(0-80)に変換する。
    file=col+1, rank=row+1、Square=(file-1)*9+(rank-1) = col*9+row (types.hのSQ_11=0起点の並びと一致)。"""
    return col * 9 + row


def inv_square(sq: int) -> int:
    """180度回転(後手視点への変換)。types.hのInv()と同じ。"""
    return (SQ_NB - 1) - sq


@dataclass
class BoardPiece:
    row: int
    col: int
    kind: str
    owner: str  # "sente" | "gote"
    promoted: bool


def bona_piece_list(pieces: list[BoardPiece], hands: dict, perspective: str) -> list[int]:
    """ある視点(perspective: "sente"=BLACK視点 or "gote"=WHITE視点)から見た、
    玉以外の全38駒(盤上+持ち駒)のBonaPiece番号のリストを返す。
    盤上の駒がowner==perspectiveならfriend(f_)、そうでなければenemy(e_)。
    perspective=="gote"のときは盤面を180度回転させてから見る(inv_square)。"""
    result: list[int] = []

    for p in pieces:
        if p.kind == "king":
            continue
        key = BOARD_KIND_TO_KEY[p.kind]
        f_off, e_off = BOARD_OFFSETS[key]
        sq = yaneura_square(p.row, p.col)
        if perspective == "gote":
            sq = inv_square(sq)
        offset = f_off if p.owner == perspective else e_off
        result.append(offset + sq)

    for owner in ("sente", "gote"):
        hand = hands.get(owner, {})
        for kind, count in hand.items():
            if count <= 0 or kind not in HAND_OFFSETS:
                continue
            f_off, e_off, max_count = HAND_OFFSETS[kind]
            offset = f_off if owner == perspective else e_off
            for i in range(min(count, max_count)):
                result.append(offset + i)

    return result


def half_kp_index(sq_k: int, bona_piece: int) -> int:
    """HalfKP::MakeIndex(sq_k, p) = fe_end * sq_k + p"""
    return FE_END * sq_k + bona_piece


def own_king_square(pieces: list[BoardPiece], perspective: str) -> int:
    for p in pieces:
        if p.kind == "king" and p.owner == perspective:
            sq = yaneura_square(p.row, p.col)
            return inv_square(sq) if perspective == "gote" else sq
    raise ValueError(f"king not found for perspective {perspective}")


def active_feature_indices(pieces: list[BoardPiece], hands: dict, perspective: str) -> list[int]:
    """HalfKP(Friend)の、ある視点から見たactive indexの一覧(最大38個)。"""
    sq_k = own_king_square(pieces, perspective)
    bona_pieces = bona_piece_list(pieces, hands, perspective)
    return [half_kp_index(sq_k, p) for p in bona_pieces]


# --- アーキテクチャの次元 ---
HALF_DIMENSIONS = 512  # kTransformedFeatureDimensions
RAW_FEATURE_DIMENSIONS = SQ_NB * FE_END  # 125388

HIDDEN1_IN = HALF_DIMENSIONS * 2  # 1024
HIDDEN1_OUT = 16
HIDDEN1_IN_PADDED = 1024  # CeilToMultiple(1024, 32) == 1024

HIDDEN2_IN = HIDDEN1_OUT  # 16
HIDDEN2_OUT = 32
HIDDEN2_IN_PADDED = 32  # CeilToMultiple(16, 32) == 32

OUTPUT_IN = HIDDEN2_OUT  # 32
OUTPUT_OUT = 1
OUTPUT_IN_PADDED = 32  # CeilToMultiple(32, 32) == 32

VERSION = 0x7AF32F16
ARCHITECTURE_STRING = "Features=HalfKP(Friend)[125388->512x2],Network=AffineTransform[1<-32](ClippedReLU[32](AffineTransform[32<-16](ClippedReLU[16](AffineTransformSparseInput[16<-1024](InputSlice[1024(0:1024)])))))"
