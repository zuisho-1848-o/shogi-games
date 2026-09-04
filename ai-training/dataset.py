"""JSONL(apps/server/src/scripts/exportNnueTrainingData.tsが出力)を読み込み、
HalfKP特徴量index(先後2視点分)+outcomeラベルに変換するデータセット。"""

import json
from dataclasses import dataclass

import torch
from torch.utils.data import Dataset

from nnue_format import BoardPiece, active_feature_indices, opponent_of


@dataclass
class Sample:
    own_indices: list[int]
    opp_indices: list[int]
    outcome: float  # turn(=side to move)側から見た結果。1=勝ち,0=負け,0.5=引き分け


def load_jsonl(path: str) -> list[Sample]:
    samples: list[Sample] = []
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            pieces = [BoardPiece(p["row"], p["col"], p["kind"], p["owner"], p["promoted"]) for p in row["board"]]
            hands = row["hands"]
            turn = row["turn"]
            opp = opponent_of(turn)
            own_idx = active_feature_indices(pieces, hands, turn)
            opp_idx = active_feature_indices(pieces, hands, opp)
            samples.append(Sample(own_idx, opp_idx, float(row["outcome"])))
    return samples


class NnueDataset(Dataset):
    def __init__(self, samples: list[Sample]):
        self.samples = samples

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, i):
        return self.samples[i]


def collate(batch: list[Sample]):
    """EmbeddingBag用に、可変長のindexリストを1本のoffsets形式にまとめる。"""
    own_flat: list[int] = []
    own_offsets = [0]
    opp_flat: list[int] = []
    opp_offsets = [0]
    outcomes = []
    for s in batch:
        own_flat.extend(s.own_indices)
        own_offsets.append(len(own_flat))
        opp_flat.extend(s.opp_indices)
        opp_offsets.append(len(opp_flat))
        outcomes.append(s.outcome)
    return (
        torch.tensor(own_flat, dtype=torch.long),
        torch.tensor(own_offsets[:-1], dtype=torch.long),
        torch.tensor(opp_flat, dtype=torch.long),
        torch.tensor(opp_offsets[:-1], dtype=torch.long),
        torch.tensor(outcomes, dtype=torch.float32),
    )
