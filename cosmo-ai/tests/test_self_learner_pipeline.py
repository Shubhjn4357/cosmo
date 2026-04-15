from __future__ import annotations

import importlib.util
import base64

import pytest
import requests

from model.tokenizer import (
    TOKENIZER_BACKEND_BYTELEVEL,
    TokenizerConfig,
    CosmoTokenizer,
)
from training.memmap_dataset import MemmapConfig, MemmapDataset


def test_agent_run_uses_runtime_and_persists_session(server):
    response = requests.post(
        f"{server.base_url}/api/agent/run",
        json={
            "message": "Summarize the current runtime in one short line.",
            "session_id": "pytest-agent-session",
            "backend": "server",
            "use_rag": False,
            "allow_research": False,
            "allow_images": False,
            "max_steps": 3,
            "max_tokens": 96,
        },
        timeout=60,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"] == "pytest-agent-session"
    assert payload["status"] == "completed"
    assert payload["backend"] == "server"
    assert payload["plan"][-1]["tool"] == "final_answer"
    assert payload["answer"].startswith("stub response:")

    session = requests.get(
        f"{server.base_url}/api/agent/sessions/{payload['session_id']}",
        timeout=60,
    )
    assert session.status_code == 200
    session_payload = session.json()
    assert session_payload["id"] == payload["session_id"]
    assert session_payload["answer"] == payload["answer"]


@pytest.mark.skipif(
    importlib.util.find_spec("tokenizers") is None,
    reason="tokenizers is not installed",
)
def test_bytelevel_tokenizer_roundtrip_preserves_whitespace(tmp_path):
    sample = "Sure! Here's a simple Python code.\nSpacing stays intact.\n\nTabs become spaces."
    tokenizer = CosmoTokenizer(
        TokenizerConfig(
            vocab_size=256,
            min_frequency=1,
            backend=TOKENIZER_BACKEND_BYTELEVEL,
        )
    )
    tokenizer.train([sample], verbose=False)

    encoded = tokenizer.encode(sample)
    decoded = tokenizer.decode(encoded)
    assert decoded == sample

    tokenizer_path = tmp_path / "tokenizer.json"
    tokenizer.save(tokenizer_path)
    reloaded = CosmoTokenizer.load(tokenizer_path)
    assert reloaded.decode(reloaded.encode(sample)) == sample


def test_memmap_dataset_length_and_bounds_are_safe(tmp_path):
    tokenizer = CosmoTokenizer(
        TokenizerConfig(
            vocab_size=256,
            min_frequency=1,
            backend=TOKENIZER_BACKEND_BYTELEVEL,
        )
    )
    tokenizer.train(
        [
            "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu",
        ],
        verbose=False,
    )

    dataset = MemmapDataset(
        MemmapConfig(memmap_dir=str(tmp_path), max_seq_len=8),
        tokenizer=tokenizer,
    )
    dataset.add_text("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu")

    assert len(dataset) == max(0, (dataset.metadata["total_tokens"] - 1) // 8)
    if len(dataset) > 0:
        input_ids, labels = dataset[0]
        assert len(input_ids) == 8
        assert len(labels) == 8

    with pytest.raises(IndexError):
        dataset[len(dataset)]


def test_self_learner_multimodal_route_handles_image_and_generation(server):
    tiny_png = base64.b64encode(
        bytes.fromhex(
            "89504E470D0A1A0A0000000D4948445200000001000000010802000000907753DE"
            "0000000C4944415408D763F8FFFF3F0005FE02FEA7D5A2FB0000000049454E44AE426082"
        )
    ).decode("ascii")

    response = requests.post(
        f"{server.base_url}/api/chat/self-learner",
        json={
            "message": "Describe this image and also generate a related image.",
            "image_data_url": f"data:image/png;base64,{tiny_png}",
            "generate_image": True,
            "use_rag": False,
            "max_tokens": 96,
        },
        timeout=60,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["image_url"]
    assert payload["multimodal"]["image_attached"] is True
    assert payload["multimodal"]["image_generated"] is True


def test_self_learner_warmup_uses_text_fallback(server):
    response = requests.post(
        f"{server.base_url}/api/chat/self-learner",
        json={
            "message": "Give me one short line about local runtimes.",
            "use_rag": False,
            "max_tokens": 64,
        },
        timeout=60,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["response"].startswith("stub response:")
    assert payload["multimodal"]["text_fallback"] is True
    assert payload["multimodal"]["text_fallback_reason"] == "self_learner_not_ready"
