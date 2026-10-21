# PaperPilot models

Two tracks:

| | What | Status |
|---|---|---|
| **PaperPilot-Mini** (`mini/`) | Our own GPT-style LLM, written from scratch: tokenizer, transformer, training loop. Learns to write from raw text. | Ready to train |
| **PaperPilot-Coder** (next) | A real coding model: an open model (e.g. Qwen Coder) trained further on PaperPilot's own examples. | Collecting examples (👍/👎 in the app) |

## Collecting examples for PaperPilot-Coder

After a coding-agent answer in the app, click 👍 (good) or 👎 (bad). The whole run (system prompt,
request, every tool call and result, final answer) is saved on this machine to
`~/.paperpilot/training/examples.jsonl` in the standard chat fine-tuning format.

```bash
npm run training:export     # → train.jsonl / val.jsonl (👍) and bad.jsonl (👎), plus counts
```

Rate only runs you'd be happy for the model to copy. Tool results contain your project's code,
so the file stays local unless you choose to share it. Target: 300+ 👍 before the first training run.

## PaperPilot-Mini

Files (all ours, ~400 lines total):

- `tokenizer.py` — byte-level BPE: learns which pieces of text become tokens.
- `model.py` — the transformer: embeddings → attention + MLP blocks → next-token prediction.
- `train.py` — downloads data, trains the tokenizer, trains the model, saves `out/ckpt.pt`.
- `sample.py` — generates text from a trained model.

### Quick check on a laptop (CPU, ~5 minutes)

```bash
cd training/mini
pip install -r requirements.txt
python train.py --preset tiny --steps 600 --max-mb 20
python sample.py --prompt "One day, Lily found a"
```

A 1.3M-parameter model that writes broken but story-like English.

### Real training on a free GPU (Kaggle, ~30–60 minutes)

1. Sign in at [kaggle.com](https://www.kaggle.com) → **Create → New Notebook**.
2. Right panel → **Settings → Accelerator → GPU T4 x2** (needs a verified phone number, free; ~30 GPU hours/week).
3. Right panel → **Internet → On**.
4. Paste into a cell and run:

```bash
!git clone https://github.com/Vishnuvardhan-978/paperpilot.git
%cd paperpilot/training/mini
!python train.py --preset mini --steps 5000 --out /kaggle/working/out
!python sample.py --out /kaggle/working/out --prompt "Once upon a time"
```

5. Download `/kaggle/working/out/ckpt.pt` and `tokenizer.json` from the **Output** panel.
   Put them in `training/mini/out/` to use them on your laptop with `sample.py`.

(The repo must be pushed first. If it is private, upload the `training/mini` folder as a Kaggle Dataset instead and `%cd` into it.)

Google Colab works the same way: **Runtime → Change runtime type → T4 GPU**.

### Presets

| Preset | Size | Where | Result |
|---|---|---|---|
| `tiny` | ~1M params | laptop CPU, minutes | story-shaped gibberish |
| `mini` | ~13M params | free T4 GPU, under an hour | simple, mostly grammatical stories |
| `small` | ~90M params | T4 for several hours (`--steps 20000`) | longer coherent stories |

### Train on your own text or code

```bash
python train.py --preset mini --data /path/to/folder --out out-code --reprepare
```

Every text / code file in the folder is used. Small models need a lot of text (tens of MB+)
to learn anything general; with a few files they memorise them instead.

### What to expect

The loss (how wrong the next-token guesses are) falls from ~8.3 to ~1.5 for `mini` on TinyStories.
A model this size learns grammar and simple stories, not facts or coding. That is what the
PaperPilot-Coder track is for: it starts from a model that already read billions of lines of code.

## PaperPilot-Coder: fine-tune and serve

`coder/finetune.py` trains a LoRA adapter on your 👍 runs, on top of an open coding model
(default `Qwen/Qwen2.5-Coder-1.5B-Instruct`, which fits a free Kaggle T4).

### 1. Export the examples (your machine)

```bash
npm run training:export      # writes ~/.paperpilot/training/export/{train,val,bad}.jsonl
```

The export contains your project code from tool results. Upload it as a **private** Kaggle Dataset.

### 2. Train (Kaggle, GPU T4, ~20–60 min for a few hundred runs)

```bash
!git clone https://github.com/Vishnuvardhan-978/paperpilot.git
%cd paperpilot/training/coder
!pip install -q -r requirements.txt
!python finetune.py --data /kaggle/input/<your-dataset> --out /kaggle/working/out --merge
```

Bigger bases (`Qwen/Qwen2.5-Coder-7B-Instruct`) need a 24 GB+ GPU or 4-bit loading.
Watch the eval loss: if it rises while train loss falls, lower `--epochs`.

### 3. Serve it (any GPU box)

vLLM, with tool calling turned on:

```bash
pip install vllm
vllm serve ./out/merged --served-model-name paperpilot-coder --enable-auto-tool-choice --tool-call-parser hermes --port 8000
```

Or Ollama: convert `out/merged` to GGUF with llama.cpp's `convert_hf_to_gguf.py`, then
`ollama create paperpilot-coder -f Modelfile` (Modelfile: `FROM ./paperpilot-coder.gguf`).
Ollama's OpenAI-compatible URL is `http://<box>:11434/v1`.

### 4. Point PaperPilot at it

Open **Settings** in the app (or edit `.env.local`):

```
OPENAI_COMPAT_BASE_URL=http://<gpu-box>:8000/v1
OPENAI_COMPAT_MODEL=paperpilot-coder
AI_PROVIDERS=custom,gemini,groq        # try your model first, fall back to the others
```

The provider badge under each answer shows whether your model or a fallback answered.
