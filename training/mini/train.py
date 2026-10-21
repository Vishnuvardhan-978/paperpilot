"""
Train PaperPilot-Mini from scratch.

  python train.py --preset tiny --steps 300                 # laptop check (CPU, a few minutes)
  python train.py --preset mini --steps 5000                # free Kaggle/Colab T4 GPU (~30-60 min)
  python train.py --preset mini --data C:/my/code/folder    # train on your own text / code files

Data:
  tinystories          short children's stories (best for tiny models: they learn real sentences)
  <folder>             every text/code file inside it
  <file.txt>           one text file
"""
import argparse
import math
import os
import time
import urllib.request

import numpy as np
import torch

from model import PRESETS, Config, PaperPilotMini
from tokenizer import Tokenizer

TINYSTORIES = {
    "train": "https://huggingface.co/datasets/roneneldan/TinyStories/resolve/main/TinyStoriesV2-GPT4-train.txt",
    "valid": "https://huggingface.co/datasets/roneneldan/TinyStories/resolve/main/TinyStoriesV2-GPT4-valid.txt",
}
TEXT_EXT = {".txt", ".md", ".js", ".ts", ".tsx", ".jsx", ".java", ".jsp", ".py", ".html", ".css", ".xml", ".json", ".sql", ".c", ".cpp", ".cs", ".go", ".rs", ".sh"}


def download(url, dest, max_mb):
    if os.path.exists(dest):
        return
    print(f"downloading {url.rsplit('/', 1)[-1]} (up to {max_mb} MB)…")
    limit = max_mb * 1024 * 1024
    got = 0
    with urllib.request.urlopen(url) as r, open(dest + ".part", "wb") as f:
        while got < limit:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            got += len(chunk)
    os.replace(dest + ".part", dest)
    print(f"  saved {got / 1e6:.1f} MB")


def load_text(source, cache, max_mb):
    if source == "tinystories":
        path = os.path.join(cache, f"tinystories-{max_mb}mb.txt")
        download(TINYSTORIES["train"], path, max_mb)
        with open(path, encoding="utf-8", errors="ignore") as f:
            text = f.read()
        # the last story is usually cut off by the size limit
        return text[: text.rfind("<|endoftext|>")]
    if os.path.isdir(source):
        parts, total = [], 0
        for root, dirs, files in os.walk(source):
            dirs[:] = [d for d in dirs if d not in {"node_modules", ".git", ".next", "dist", "build", "target", "__pycache__"}]
            for name in sorted(files):
                if os.path.splitext(name)[1].lower() not in TEXT_EXT:
                    continue
                try:
                    with open(os.path.join(root, name), encoding="utf-8", errors="ignore") as f:
                        parts.append(f.read())
                except OSError:
                    continue
                total += len(parts[-1])
                if total > max_mb * 1024 * 1024:
                    break
        print(f"read {len(parts)} files from {source}")
        return "<|endoftext|>".join(parts)
    with open(source, encoding="utf-8", errors="ignore") as f:
        return f.read(max_mb * 1024 * 1024)


def prepare(args):
    os.makedirs(args.out, exist_ok=True)
    tok_path = os.path.join(args.out, "tokenizer.json")
    train_bin, val_bin = os.path.join(args.out, "train.bin"), os.path.join(args.out, "val.bin")
    if os.path.exists(tok_path) and os.path.exists(train_bin) and not args.reprepare:
        return Tokenizer.load(tok_path), np.memmap(train_bin, dtype=np.uint16, mode="r"), np.memmap(val_bin, dtype=np.uint16, mode="r")

    text = load_text(args.data, args.cache, args.max_mb)
    print(f"text: {len(text) / 1e6:.1f} M characters")
    t = time.time()
    tok = Tokenizer.train(text[: args.tokenizer_chars], vocab_size=args.vocab)
    tok.save(tok_path)
    print(f"tokenizer: {tok.vocab_size} tokens, trained in {time.time() - t:.0f}s")

    t = time.time()
    ids = np.array(tok.encode(text), dtype=np.uint16)
    print(f"encoded {len(ids) / 1e6:.1f} M tokens in {time.time() - t:.0f}s ({len(text) / max(len(ids), 1):.1f} chars/token)")
    split = int(len(ids) * 0.95)
    ids[:split].tofile(train_bin)
    ids[split:].tofile(val_bin)
    return tok, np.memmap(train_bin, dtype=np.uint16, mode="r"), np.memmap(val_bin, dtype=np.uint16, mode="r")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default="tinystories")
    ap.add_argument("--preset", default="tiny", choices=PRESETS)
    ap.add_argument("--steps", type=int, default=300)
    ap.add_argument("--batch", type=int, default=None, help="sequences per step (default depends on device)")
    ap.add_argument("--lr", type=float, default=None)
    ap.add_argument("--vocab", type=int, default=4096)
    ap.add_argument("--max-mb", type=int, default=None, help="how much text to use (default: 30 on CPU, 300 on GPU)")
    ap.add_argument("--tokenizer-chars", type=int, default=3_000_000, help="text used to learn the tokenizer")
    ap.add_argument("--eval-every", type=int, default=None)
    ap.add_argument("--out", default="out")
    ap.add_argument("--cache", default="data")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--reprepare", action="store_true", help="rebuild tokenizer and data files")
    args = ap.parse_args()

    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    gpu = device == "cuda"
    args.max_mb = args.max_mb or (300 if gpu else 30)
    batch = args.batch or (64 if gpu else 16)
    lr = args.lr or (6e-4 if args.preset != "small" else 3e-4)
    eval_every = args.eval_every or max(50, args.steps // 20)
    os.makedirs(args.cache, exist_ok=True)

    torch.manual_seed(1337)
    tok, train_ids, val_ids = prepare(args)

    ckpt_path = os.path.join(args.out, "ckpt.pt")
    start_step, best_val = 0, float("inf")
    if args.resume and os.path.exists(ckpt_path):
        ckpt = torch.load(ckpt_path, map_location=device)
        config = Config(**ckpt["config"])
        model = PaperPilotMini(config).to(device)
        model.load_state_dict(ckpt["model"])
        start_step, best_val = ckpt["step"], ckpt["val_loss"]
        print(f"resumed from step {start_step} (val loss {best_val:.3f})")
    else:
        config = Config(vocab_size=tok.vocab_size, **PRESETS[args.preset])
        model = PaperPilotMini(config).to(device)
    print(f"device: {device} | model: {model.num_params() / 1e6:.2f} M parameters | batch {batch} x {config.context} tokens")

    decay = [p for p in model.parameters() if p.dim() >= 2]
    no_decay = [p for p in model.parameters() if p.dim() < 2]
    opt = torch.optim.AdamW([{"params": decay, "weight_decay": 0.1}, {"params": no_decay, "weight_decay": 0.0}], lr=lr, betas=(0.9, 0.95))
    if args.resume and os.path.exists(ckpt_path) and "optimizer" in ckpt:
        opt.load_state_dict(ckpt["optimizer"])

    amp_dtype = torch.bfloat16 if gpu and torch.cuda.is_bf16_supported() else torch.float16
    scaler = torch.amp.GradScaler("cuda", enabled=gpu and amp_dtype == torch.float16)
    autocast = lambda: torch.autocast(device_type="cuda", dtype=amp_dtype) if gpu else torch.autocast(device_type="cpu", enabled=False)  # noqa: E731

    def batch_of(data):
        ix = torch.randint(len(data) - config.context - 1, (batch,))
        x = torch.stack([torch.from_numpy(data[i : i + config.context].astype(np.int64)) for i in ix])
        y = torch.stack([torch.from_numpy(data[i + 1 : i + 1 + config.context].astype(np.int64)) for i in ix])
        return (x.pin_memory().to(device, non_blocking=True), y.pin_memory().to(device, non_blocking=True)) if gpu else (x.to(device), y.to(device))

    @torch.no_grad()
    def evaluate(iters=20):
        model.eval()
        out = {}
        for name, data in (("train", train_ids), ("val", val_ids)):
            losses = []
            for _ in range(iters):
                x, y = batch_of(data)
                with autocast():
                    _, loss = model(x, y)
                losses.append(loss.item())
            out[name] = sum(losses) / len(losses)
        model.train()
        return out

    def lr_at(step):
        warmup = max(20, args.steps // 50)
        if step < warmup:
            return lr * (step + 1) / warmup
        progress = (step - warmup) / max(1, args.steps - warmup)
        return lr * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * min(progress, 1.0))))

    def sample(prompt="Once upon a time", n=80):
        model.eval()
        idx = torch.tensor([tok.encode(prompt)], device=device)
        text = tok.decode(model.generate(idx, max_new_tokens=n, stop_token=tok.eot)[0].tolist())
        model.train()
        return text.replace("<|endoftext|>", "").strip()

    model.train()
    t0 = time.time()
    for step in range(start_step, args.steps):
        for g in opt.param_groups:
            g["lr"] = lr_at(step)
        x, y = batch_of(train_ids)
        with autocast():
            _, loss = model(x, y)
        opt.zero_grad(set_to_none=True)
        scaler.scale(loss).backward()
        scaler.unscale_(opt)
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        scaler.step(opt)
        scaler.update()

        if step % 10 == 0:
            done = step - start_step + 1
            eta = (time.time() - t0) / done * (args.steps - step - 1)
            print(f"step {step:>6}/{args.steps}  loss {loss.item():.3f}  lr {lr_at(step):.2e}  eta {eta / 60:.1f} min", flush=True)

        if (step + 1) % eval_every == 0 or step + 1 == args.steps:
            losses = evaluate()
            print(f"--- eval step {step + 1}: train {losses['train']:.3f}  val {losses['val']:.3f}")
            print(f"    sample: {sample()!r}")
            if losses["val"] < best_val:
                best_val = losses["val"]
                torch.save(
                    {"model": model.state_dict(), "optimizer": opt.state_dict(), "config": model.config_dict(), "step": step + 1, "val_loss": best_val},
                    ckpt_path,
                )
                print(f"    saved {ckpt_path} (best val {best_val:.3f})")

    print(f"done in {(time.time() - t0) / 60:.1f} min. Try it: python sample.py --out {args.out}")


if __name__ == "__main__":
    main()
