from __future__ import annotations

from pathlib import Path

import requests


def test_dataset_upload_list_and_download(server, admin_headers, tmp_path: Path):
    dataset_path = tmp_path / "sample.jsonl"
    content = b'{"input":"hello","output":"world"}\n'
    dataset_path.write_bytes(content)

    with dataset_path.open("rb") as handle:
        upload = requests.post(
            f"{server.base_url}/api/datasets/upload",
            headers=admin_headers,
            files={"file": (dataset_path.name, handle, "application/json")},
            timeout=60,
        )

    assert upload.status_code == 200
    uploaded_name = upload.json()["dataset"]["name"]
    assert uploaded_name == dataset_path.name

    datasets = requests.get(f"{server.base_url}/api/datasets", headers=admin_headers, timeout=60)
    assert datasets.status_code == 200
    names = {item["name"] for item in datasets.json()["datasets"]}
    assert dataset_path.name in names

    download = requests.get(
        f"{server.base_url}/api/datasets/download/{dataset_path.name}",
        headers=admin_headers,
        timeout=60,
    )
    assert download.status_code == 200
    assert download.content == content

    stored_path = server.data_root / "datasets" / dataset_path.name
    assert stored_path.exists()
