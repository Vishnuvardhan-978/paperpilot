"""
PaperPilot-Mini: a GPT-style transformer, written from scratch in PyTorch.

tokens -> embeddings (+ position) -> N x [attention + MLP] -> next-token scores
"""
import math
from dataclasses import dataclass, asdict

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class Config:
    vocab_size: int = 4097
    context: int = 256  # how many tokens the model can look back at
    n_layer: int = 6
    n_head: int = 6
    n_embd: int = 384
    dropout: float = 0.1


PRESETS = {
    # quick CPU check (a minute on a laptop)
    "tiny": dict(context=128, n_layer=4, n_head=4, n_embd=128, dropout=0.0),
    # free Kaggle / Colab T4 GPU, ~30-60 min for a model that writes simple stories
    "mini": dict(context=256, n_layer=6, n_head=6, n_embd=384, dropout=0.1),
    # longer GPU runs (several hours)
    "small": dict(context=512, n_layer=12, n_head=12, n_embd=768, dropout=0.1),
}


class SelfAttention(nn.Module):
    """Each token looks at the tokens before it and decides which ones matter."""

    def __init__(self, c: Config):
        super().__init__()
        assert c.n_embd % c.n_head == 0
        self.n_head = c.n_head
        self.qkv = nn.Linear(c.n_embd, 3 * c.n_embd)
        self.proj = nn.Linear(c.n_embd, c.n_embd)
        self.dropout = c.dropout
        self.resid_drop = nn.Dropout(c.dropout)

    def forward(self, x):
        B, T, C = x.shape
        q, k, v = self.qkv(x).split(C, dim=2)
        # (B, T, C) -> (B, heads, T, head_size)
        q, k, v = (t.view(B, T, self.n_head, C // self.n_head).transpose(1, 2) for t in (q, k, v))
        y = F.scaled_dot_product_attention(q, k, v, is_causal=True, dropout_p=self.dropout if self.training else 0.0)
        y = y.transpose(1, 2).contiguous().view(B, T, C)
        return self.resid_drop(self.proj(y))


class MLP(nn.Module):
    """Per-token 'thinking' layer."""

    def __init__(self, c: Config):
        super().__init__()
        self.up = nn.Linear(c.n_embd, 4 * c.n_embd)
        self.down = nn.Linear(4 * c.n_embd, c.n_embd)
        self.drop = nn.Dropout(c.dropout)

    def forward(self, x):
        return self.drop(self.down(F.gelu(self.up(x))))


class Block(nn.Module):
    def __init__(self, c: Config):
        super().__init__()
        self.ln1 = nn.LayerNorm(c.n_embd)
        self.attn = SelfAttention(c)
        self.ln2 = nn.LayerNorm(c.n_embd)
        self.mlp = MLP(c)

    def forward(self, x):
        x = x + self.attn(self.ln1(x))
        return x + self.mlp(self.ln2(x))


class PaperPilotMini(nn.Module):
    def __init__(self, c: Config):
        super().__init__()
        self.config = c
        self.tok_emb = nn.Embedding(c.vocab_size, c.n_embd)
        self.pos_emb = nn.Embedding(c.context, c.n_embd)
        self.drop = nn.Dropout(c.dropout)
        self.blocks = nn.ModuleList(Block(c) for _ in range(c.n_layer))
        self.ln_f = nn.LayerNorm(c.n_embd)
        self.head = nn.Linear(c.n_embd, c.vocab_size, bias=False)
        self.head.weight = self.tok_emb.weight  # weight tying: fewer parameters, trains better
        self.apply(self._init)
        for name, p in self.named_parameters():
            if name.endswith("proj.weight") or name.endswith("down.weight"):
                nn.init.normal_(p, mean=0.0, std=0.02 / math.sqrt(2 * c.n_layer))

    @staticmethod
    def _init(m):
        if isinstance(m, nn.Linear):
            nn.init.normal_(m.weight, mean=0.0, std=0.02)
            if m.bias is not None:
                nn.init.zeros_(m.bias)
        elif isinstance(m, nn.Embedding):
            nn.init.normal_(m.weight, mean=0.0, std=0.02)

    def num_params(self):
        return sum(p.numel() for p in self.parameters()) - self.pos_emb.weight.numel()

    def forward(self, idx, targets=None):
        B, T = idx.shape
        assert T <= self.config.context, f"sequence {T} longer than context {self.config.context}"
        pos = torch.arange(T, device=idx.device)
        x = self.drop(self.tok_emb(idx) + self.pos_emb(pos))
        for block in self.blocks:
            x = block(x)
        logits = self.head(self.ln_f(x))
        loss = None
        if targets is not None:
            loss = F.cross_entropy(logits.view(-1, logits.size(-1)), targets.view(-1))
        return logits, loss

    @torch.no_grad()
    def generate(self, idx, max_new_tokens=200, temperature=0.8, top_k=50, stop_token=None):
        for _ in range(max_new_tokens):
            logits, _ = self(idx[:, -self.config.context :])
            logits = logits[:, -1, :] / max(temperature, 1e-5)
            if top_k:
                v, _ = torch.topk(logits, min(top_k, logits.size(-1)))
                logits[logits < v[:, [-1]]] = -float("inf")
            nxt = torch.multinomial(F.softmax(logits, dim=-1), num_samples=1)
            idx = torch.cat((idx, nxt), dim=1)
            if stop_token is not None and nxt.item() == stop_token:
                break
        return idx

    def config_dict(self):
        return asdict(self.config)
