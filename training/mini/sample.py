"""
Talk to a trained PaperPilot-Mini.

  python sample.py --prompt "Once upon a time"
  python sample.py --out out --prompt "The robot" --tokens 200 --temperature 0.7
"""
import argparse
import os

import torch

from model import Config, PaperPilotMini
from tokenizer import Tokenizer


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out")
    ap.add_argument("--prompt", default="Once upon a time")
    ap.add_argument("--tokens", type=int, default=200)
    ap.add_argument("--temperature", type=float, default=0.8)
    ap.add_argument("--top-k", type=int, default=50)
    ap.add_argument("--n", type=int, default=2, help="how many samples")
    args = ap.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    ckpt = torch.load(os.path.join(args.out, "ckpt.pt"), map_location=device)
    model = PaperPilotMini(Config(**ckpt["config"])).to(device).eval()
    model.load_state_dict(ckpt["model"])
    tok = Tokenizer.load(os.path.join(args.out, "tokenizer.json"))
    print(f"PaperPilot-Mini: {model.num_params() / 1e6:.2f} M parameters, trained {ckpt['step']} steps, val loss {ckpt['val_loss']:.3f}\n")

    for i in range(args.n):
        idx = torch.tensor([tok.encode(args.prompt)], device=device)
        out = model.generate(idx, max_new_tokens=args.tokens, temperature=args.temperature, top_k=args.top_k, stop_token=tok.eot)
        print(f"--- sample {i + 1} ---\n{tok.decode(out[0].tolist()).replace('<|endoftext|>', '').strip()}\n")


if __name__ == "__main__":
    main()
