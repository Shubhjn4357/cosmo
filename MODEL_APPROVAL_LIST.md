# Model Approval List

Updated: 2026-03-31

Purpose: proposed downloadable model catalog for Whisper app/server approval.

This is not "every downloadable model on Hugging Face". That would be too large and unstable.
This is a practical inclusion list for the current Whisper architecture:

- Mobile local text: GGUF only
- Server text: GGUF or Transformers on CPU-friendly deployments
- Image generation: Hugging Face Inference API or downloadable local weights
- Unrestricted / NSFW: separate opt-in pack only

## Approval Rules

- Include by default: safe, current, broadly useful, good fit for the current app/server
- Optional pack: valid, but heavier, more niche, or needs stronger hardware
- Do not include by default: old, redundant, or likely to create support burden

## 1. Text Models

### Include Now

| Status | Use | Model | Why include | Link |
| --- | --- | --- | --- | --- |
| Approve | Mobile local | Qwen3 1.7B GGUF Q4_K_M | Best modern tiny local text model class for speed/quality balance | https://huggingface.co/Qwen/Qwen3-1.7B-GGUF |
| Approve | Mobile local / server | Qwen3 4B Instruct 2507 GGUF Q4_K_M | Stronger latest small instruct model for better quality | https://huggingface.co/prithivMLmods/Qwen3-4B-Instruct-2507-GGUF |
| Approve | Mobile ultra-light | Llama 3.2 1B Instruct GGUF Q4_K_M | Smallest practical offline fallback | https://huggingface.co/llmware/llama-3.2-1b-gguf |
| Approve | Mobile local / server | Gemma 3 4B IT GGUF Q4_K_M | Current Google small open model family, strong general quality | https://huggingface.co/unsloth/gemma-3-4b-it-GGUF |
| Approve | Server CPU | DeepSeek-R1 Distill Qwen 7B GGUF Q4_K_M | Best reasoning-oriented server option in this size class | https://huggingface.co/lmstudio-community/DeepSeek-R1-Distill-Qwen-7B-GGUF |

### Optional

| Status | Use | Model | Why optional | Link |
| --- | --- | --- | --- | --- |
| Optional | Server CPU | Qwen 2.5 1.5B Instruct GGUF | Already integrated and very cheap to run, but older than Qwen3 | https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF |
| Optional | Server CPU | Qwen 2.5 7B Instruct GGUF | Still strong, but Qwen3/DeepSeek distills are a better 2026-facing list | https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF |
| Optional | Mobile / server | Llama 3.2 3B Instruct GGUF | Good fallback for users who prefer Meta models | https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF |
| Optional | Server CPU | Gemma 2 9B IT GGUF | Good model, but Gemma 3 is the fresher family | https://huggingface.co/bartowski/gemma-2-9b-it-GGUF |
| Optional | Server high-RAM | Mistral Nemo Instruct GGUF | Good large option, but heavier and less essential for default catalog | https://huggingface.co/bartowski/Mistral-Nemo-Instruct-2407-GGUF |

### Do Not Include By Default

| Status | Model | Why not default |
| --- | --- | --- |
| Skip default | TinyLlama 1.1B | Too old and noticeably weaker than Qwen3 1.7B / Llama 3.2 1B |
| Skip default | Phi-3.5 Mini GGUF | Still usable, but the shortlist above is easier to support |
| Skip default | Multiple near-duplicate 7B models | Too much catalog bloat for too little user value |

## 2. Image Generation Models

### Include Now

| Status | Use | Model | Why include | Link |
| --- | --- | --- | --- | --- |
| Approve | Server default | FLUX.1 Schnell | Best practical default for fast image generation and already aligned with current server flow | https://huggingface.co/black-forest-labs/FLUX.1-schnell |
| Approve | Downloadable local/server | FLUX.1 Schnell GGUF Q4_K_S | Best downloadable FLUX GGUF balance right now | https://huggingface.co/city96/FLUX.1-schnell-gguf |
| Approve | Server high-quality | Qwen-Image | Latest major open image model family to track for higher quality and text rendering | https://huggingface.co/Qwen/Qwen-Image |
| Approve | Server image editing | FLUX.1 Kontext dev | Strong latest editing model for instruction-based image edits | https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev |

### Optional

| Status | Use | Model | Why optional | Link |
| --- | --- | --- | --- | --- |
| Optional | Server high-quality | FLUX.1 dev | Better quality than Schnell, but heavier and more restrictive operationally | https://huggingface.co/black-forest-labs/FLUX.1-dev |
| Optional | Server photo style | FLUX.1 Krea dev | Good photo/aesthetic variant, but not needed for v1 catalog | https://huggingface.co/black-forest-labs/FLUX.1-Krea-dev |
| Optional | Downloadable local/server | Stable Diffusion 3.5 Medium GGUF Q4 | Valid downloadable image option, but heavier and less aligned than FLUX now | https://huggingface.co/city96/stable-diffusion-3.5-medium-gguf |

### Do Not Include By Default

| Status | Model family | Why not default |
| --- | --- | --- |
| Skip default | DreamShaper / Deliberate / OpenJourney / SD 1.5 general models | Older generation, redundant once FLUX and Qwen-Image are available |
| Skip default | Long tail SDXL variants | Too many duplicates, confusing UX, hard to support |
| Skip default | Multiple quant levels for every image model | Keep only 1 compact + 1 balanced variant unless users ask for more |

## 3. Unrestricted / NSFW Text Models

Important: these should not be mixed into the main safe catalog.

Recommended product rule:

- Hide behind explicit `18+` opt-in
- Separate tab or downloadable add-on
- Disabled by default

### Optional Unrestricted Pack

| Status | Use | Model | Why include | Link |
| --- | --- | --- | --- | --- |
| Optional | Mobile / server | Llama 3.2 3B Instruct Abliterated GGUF | Cleanest unrestricted small-model baseline to expose if you want one uncensored text option | https://huggingface.co/QuantFactory/Llama-3.2-3B-Instruct-abliterated-GGUF |
| Optional | Server roleplay / creative | L3.2 Rogue Creative Uncensored Abliterated 7B GGUF | Better for roleplay/creative writing users than plain abliterated builds | https://huggingface.co/DavidAU/L3.2-Rogue-Creative-Instruct-Uncensored-Abliterated-7B-GGUF |
| Optional | Mobile ultra-light roleplay | NSFW RP 3.2 1B GGUF | Only if you want a tiny uncensored roleplay model | https://huggingface.co/Novaciano/NSFW_RP-3.2-1B-GGUF |

## 4. Unrestricted / NSFW Image Models

Important: same rule as above. Keep separate from the safe default catalog.

### Optional Unrestricted Image Pack

| Status | Use | Model | Why include | Link |
| --- | --- | --- | --- | --- |
| Optional | Server / local | Pony Diffusion V6 XL | Most recognizable unrestricted SDXL family to support | https://huggingface.co/LyliaEngine/Pony_Diffusion_V6_XL |
| Optional | Downloadable local | Pony Diffusion V6 XL GGUF | Downloadable GGUF route if you want uncensored local image generation | https://huggingface.co/morikomorizz/Pony-Diffusion-V6-XL-GGUF |
| Optional | Server / local | CyberRealistic | Best simple photorealistic unrestricted SD1.5 style pick | https://huggingface.co/cyberdelia/CyberRealistic |

### Do Not Include By Default

| Status | Model family | Why not default |
| --- | --- | --- |
| Skip default | Large bundles of anime NSFW checkpoints | Very high moderation and support burden |
| Skip default | Dozens of Pony / AutismMix derivatives | Too much duplication for the first catalog |

## 5. Final Proposed Catalog

If you want the cleanest v1 catalog, I recommend approving only this:

### Text

- Qwen3 1.7B GGUF
- Qwen3 4B Instruct GGUF
- Llama 3.2 1B Instruct GGUF
- Gemma 3 4B IT GGUF
- DeepSeek-R1 Distill Qwen 7B GGUF

### Image

- FLUX.1 Schnell
- FLUX.1 Schnell GGUF Q4
- Qwen-Image
- FLUX.1 Kontext dev

### Unrestricted / NSFW Pack

- Llama 3.2 3B Abliterated GGUF
- L3.2 Rogue Creative Uncensored 7B GGUF
- Pony Diffusion V6 XL
- CyberRealistic

## 6. Recommended Approval Decision

Approve now:

- Main text catalog
- Main image catalog

Approve only if you explicitly want 18+ support:

- Unrestricted / NSFW text pack
- Unrestricted / NSFW image pack

Do not approve now:

- Old SD1.5 long-tail model list
- Very large duplicate GGUF catalogs
- Huge uncensored bundles
