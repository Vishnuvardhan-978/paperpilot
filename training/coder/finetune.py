"""
PaperPilot-Coder: LoRA fine-tune of an open coding model on PaperPilot's rated agent runs.

    npm run training:export                        # on your machine -> train.jsonl / val.jsonl
    python finetune.py --data ./export --out ./out # on a GPU (Kaggle T4 works for 1.5B)

Input rows are {"messages": [...], "tools": [...]} in the OpenAI chat format written by
scripts/training-export.mjs. Output: a LoRA adapter in <out>/adapter and, with --merge,
a full model in <out>/merged that vLLM or Ollama can serve.
"""

import argparse
import json
import os
from pathlib import Path

import torch
from datasets import Dataset
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer
from trl import SFTConfig, SFTTrainer


def load_rows(path: Path):
    rows = []
    if not path.exists():
        return rows
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        rows.append({"messages": [fix_message(m) for m in row["messages"]], "tools": row.get("tools") or []})
    return rows


def fix_message(m):
    """Chat templates (Qwen, Llama) want tool-call arguments as objects, not JSON strings."""
    m = dict(m)
    if m.get("content") is None:
        m["content"] = ""
    calls = []
    for c in m.get("tool_calls") or []:
        fn = dict(c.get("function", {}))
        args = fn.get("arguments")
        if isinstance(args, str):
            try:
                fn["arguments"] = json.loads(args or "{}")
            except json.JSONDecodeError:
                fn["arguments"] = {"raw": args}
        calls.append({**c, "function": fn})
    if calls:
        m["tool_calls"] = calls
    return m


def to_text(tokenizer, row, max_chars):
    text = tokenizer.apply_chat_template(row["messages"], tools=row["tools"] or None, tokenize=False)
    return {"text": text[-max_chars:]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="./export", help="folder with train.jsonl / val.jsonl")
    ap.add_argument("--base", default="Qwen/Qwen2.5-Coder-1.5B-Instruct", help="Hugging Face base model")
    ap.add_argument("--out", default="./out")
    ap.add_argument("--epochs", type=float, default=2)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--max-len", type=int, default=4096)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--batch", type=int, default=1)
    ap.add_argument("--accum", type=int, default=8)
    ap.add_argument("--merge", action="store_true", help="also save a merged full model for serving")
    args = ap.parse_args()

    data = Path(args.data)
    train_rows = load_rows(data / "train.jsonl")
    val_rows = load_rows(data / "val.jsonl")
    if not train_rows:
        raise SystemExit(f"No training rows in {data / 'train.jsonl'}. Run `npm run training:export` and copy the export folder here.")
    print(f"train {len(train_rows)} · val {len(val_rows)} · base {args.base}")

    tokenizer = AutoTokenizer.from_pretrained(args.base)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    max_chars = args.max_len * 4  # rough: keep the end of long runs, where the final answer is
    train_ds = Dataset.from_list(train_rows).map(lambda r: to_text(tokenizer, r, max_chars), remove_columns=["messages", "tools"])
    val_ds = Dataset.from_list(val_rows).map(lambda r: to_text(tokenizer, r, max_chars), remove_columns=["messages", "tools"]) if val_rows else None

    bf16 = torch.cuda.is_available() and torch.cuda.is_bf16_supported()
    model = AutoModelForCausalLM.from_pretrained(
        args.base,
        torch_dtype=torch.bfloat16 if bf16 else torch.float16 if torch.cuda.is_available() else torch.float32,
        device_map="auto" if torch.cuda.is_available() else None,
    )

    config = SFTConfig(
        output_dir=args.out,
        num_train_epochs=args.epochs,
        learning_rate=args.lr,
        per_device_train_batch_size=args.batch,
        gradient_accumulation_steps=args.accum,
        gradient_checkpointing=True,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        logging_steps=5,
        eval_strategy="epoch" if val_ds is not None else "no",
        save_strategy="epoch",
        save_total_limit=2,
        bf16=bf16,
        fp16=torch.cuda.is_available() and not bf16,
        max_length=args.max_len,
        dataset_text_field="text",
        report_to="none",
    )
    lora = LoraConfig(
        r=args.rank,
        lora_alpha=args.rank * 2,
        lora_dropout=0.05,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        task_type="CAUSAL_LM",
    )
    trainer = SFTTrainer(model=model, args=config, train_dataset=train_ds, eval_dataset=val_ds, processing_class=tokenizer, peft_config=lora)
    trainer.train()

    adapter = os.path.join(args.out, "adapter")
    trainer.model.save_pretrained(adapter)
    tokenizer.save_pretrained(adapter)
    print(f"saved LoRA adapter -> {adapter}")

    if args.merge:
        merged = trainer.model.merge_and_unload()
        path = os.path.join(args.out, "merged")
        merged.save_pretrained(path, safe_serialization=True)
        tokenizer.save_pretrained(path)
        print(f"saved merged model -> {path}")


if __name__ == "__main__":
    main()
