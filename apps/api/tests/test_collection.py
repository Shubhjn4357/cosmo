from __future__ import annotations

import requests


def test_collection_config_reports_local_backend(server):
    response = requests.get(f"{server.base_url}/api/collect/config", timeout=60)
    assert response.status_code == 200
    payload = response.json()

    assert payload["backend"] == "local"
    assert payload["test_mode"] is True
    assert payload["text_source_count"] >= 1
    assert payload["image_source_count"] >= 1


def test_collection_ingests_images_into_local_vision_feed(server):
    before = requests.get(f"{server.base_url}/api/feed/vision/stats", timeout=60)
    assert before.status_code == 200
    before_total = before.json()["storage"]["total_images"]

    collect = requests.post(
        f"{server.base_url}/api/collect/collect",
        json={
            "source_type": "images",
            "count": 2,
            "auto_feed": True,
        },
        timeout=60,
    )
    assert collect.status_code == 200
    payload = collect.json()

    assert payload["success"] is True
    assert payload["image_encoder_backend"] == "local"
    assert payload["collected"]["images"] == 2
    assert payload["collected"]["encoded_and_learned"] == 2
    assert all(item["backend"] == "local" for item in payload["data"]["encoded"])
    assert all(item["preview_url"] for item in payload["data"]["encoded"])
    assert all(item["image_url"] for item in payload["data"]["encoded"])

    after = requests.get(f"{server.base_url}/api/feed/vision/stats", timeout=60)
    assert after.status_code == 200
    after_payload = after.json()
    assert after_payload["storage"]["total_images"] == before_total + 2
    assert any(source.startswith("collector:") for source in after_payload["storage"]["sources"])

    stats = requests.get(f"{server.base_url}/api/collect/stats", timeout=60)
    assert stats.status_code == 200
    stats_payload = stats.json()
    assert stats_payload["encoded_locally"] >= 2

    sample = requests.get(f"{server.base_url}/api/feed/vision/sample?count=2", timeout=60)
    assert sample.status_code == 200
    sample_payload = sample.json()
    assert len(sample_payload["samples"]) == 2
    assert all(item["preview_url"] for item in sample_payload["samples"])

    preview_response = requests.get(f"{server.base_url}{sample_payload['samples'][0]['preview_url']}", timeout=60)
    assert preview_response.status_code == 200
    assert preview_response.headers["content-type"].startswith("image/")


def test_vision_generate_returns_retrieval_examples(server):
    collect = requests.post(
        f"{server.base_url}/api/collect/collect",
        json={
            "source_type": "images",
            "count": 2,
            "auto_feed": True,
        },
        timeout=60,
    )
    assert collect.status_code == 200

    response = requests.post(
        f"{server.base_url}/api/feed/vision/generate",
        params={
            "prompt": "nasa space image",
            "use_pretrained": "false",
            "use_trained_model": "false",
        },
        json={},
        timeout=60,
    )
    assert response.status_code == 200
    payload = response.json()

    assert payload["method"] == "retrieval"
    assert payload["knowledge_base_size"] >= 2
    assert payload["retrieval_examples"]
    assert payload["generated_image"]
    assert payload["generated_image"].startswith("/static/vision-feed/")
