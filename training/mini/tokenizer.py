"""
Byte-level BPE tokenizer, written from scratch (same idea as GPT-2's).

Text -> UTF-8 bytes (256 base tokens) -> repeatedly merge the most frequent
neighbouring pair into a new token. Any text can be encoded (no "unknown" token).
"""
import json
import re
from collections import Counter, defaultdict

# Split text into words / numbers / punctuation / spaces before merging,
# so merges never glue the end of one word to the start of the next.
SPLIT = re.compile(r"""'s|'t|'re|'ve|'m|'ll|'d| ?[A-Za-z]+| ?[0-9]{1,3}| ?[^\sA-Za-z0-9]+|\s+(?!\S)|\s+""")

SPECIAL = {"<|endoftext|>": None}


class Tokenizer:
    def __init__(self, merges=None):
        self.merges = merges or []  # list of (a, b) pairs, in merge order
        self._build()

    def _build(self):
        self.rank = {pair: 256 + i for i, pair in enumerate(self.merges)}
        self.vocab = {i: bytes([i]) for i in range(256)}
        for (a, b), idx in self.rank.items():
            self.vocab[idx] = self.vocab[a] + self.vocab[b]
        self.eot = 256 + len(self.merges)  # <|endoftext|> sits after the merges
        self.vocab_size = self.eot + 1
        self._cache = {}

    # ---------- training ----------

    @classmethod
    def train(cls, text, vocab_size=4096, verbose=True):
        if vocab_size < 257:
            raise ValueError("vocab_size must be at least 257")
        words = Counter(SPLIT.findall(text))
        seqs = [list(w.encode("utf-8")) for w in words]
        freqs = list(words.values())

        pair_count = Counter()
        where = defaultdict(set)  # pair -> indices of words containing it
        for i, s in enumerate(seqs):
            for p in zip(s, s[1:]):
                pair_count[p] += freqs[i]
                where[p].add(i)

        merges = []
        n_merges = vocab_size - 257
        for m in range(n_merges):
            if not pair_count:
                break
            best = max(pair_count, key=pair_count.get)
            if pair_count[best] < 2:
                break
            new_id = 256 + m
            merges.append(best)
            for i in list(where[best]):
                s = seqs[i]
                f = freqs[i]
                for p in zip(s, s[1:]):  # remove old pairs of this word
                    pair_count[p] -= f
                    if pair_count[p] <= 0:
                        del pair_count[p]
                    where[p].discard(i)
                out, j = [], 0
                while j < len(s):
                    if j < len(s) - 1 and (s[j], s[j + 1]) == best:
                        out.append(new_id)
                        j += 2
                    else:
                        out.append(s[j])
                        j += 1
                seqs[i] = out
                for p in zip(out, out[1:]):  # add the new pairs
                    pair_count[p] += f
                    where[p].add(i)
            where.pop(best, None)
            if verbose and (m + 1) % 500 == 0:
                print(f"  tokenizer: {m + 1}/{n_merges} merges")
        return cls(merges)

    # ---------- encode / decode ----------

    def _encode_word(self, word):
        hit = self._cache.get(word)
        if hit is not None:
            return hit
        ids = list(word.encode("utf-8"))
        while len(ids) > 1:
            pairs = [(self.rank.get(p, 1 << 30), k) for k, p in enumerate(zip(ids, ids[1:]))]
            r, k = min(pairs)
            if r == 1 << 30:
                break
            ids[k : k + 2] = [r]
        if len(self._cache) < 500_000:
            self._cache[word] = ids
        return ids

    def encode(self, text, allow_special=True):
        out = []
        parts = text.split("<|endoftext|>") if allow_special else [text]
        for n, part in enumerate(parts):
            if n:
                out.append(self.eot)
            for w in SPLIT.findall(part):
                out.extend(self._encode_word(w))
        return out

    def decode(self, ids):
        data = b"".join(self.vocab[i] if i != self.eot else b"<|endoftext|>" for i in ids if i in self.vocab or i == self.eot)
        return data.decode("utf-8", errors="replace")

    # ---------- save / load ----------

    def save(self, path):
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"type": "paperpilot-bpe", "merges": self.merges}, f)

    @classmethod
    def load(cls, path):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return cls([tuple(p) for p in data["merges"]])


if __name__ == "__main__":
    sample = "Once upon a time, a little robot wanted to read every paper in the library. " * 50
    tok = Tokenizer.train(sample, vocab_size=300, verbose=False)
    ids = tok.encode("Once upon a time, the robot read a paper.<|endoftext|>")
    assert tok.decode(ids) == "Once upon a time, the robot read a paper.<|endoftext|>", tok.decode(ids)
    assert tok.decode(tok.encode("नमस्ते 🙂 code(){}")) == "नमस्ते 🙂 code(){}"
    print(f"ok: {len(ids)} tokens, vocab {tok.vocab_size}")
