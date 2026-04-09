from services.approved_model_catalog import (
    bootstrap_image_models,
    bootstrap_text_models,
    get_text_model,
)


def test_gemma4_uncensored_models_are_available_for_local_install():
    e2b = get_text_model("gemma-4-e2b-uncensored-q4km")
    e4b = get_text_model("gemma-4-e4b-uncensored-q4km")

    assert e2b is not None
    assert e4b is not None

    assert e2b.supports_local is True
    assert e2b.downloadable is True
    assert e2b.adult is True
    assert e2b.size_mb == 2769
    assert e2b.filename == "Gemma-4-E2B-uncensored-pruned-TextOnly-EnglishOnly-Q4_K_M.gguf"

    assert e4b.supports_local is True
    assert e4b.downloadable is True
    assert e4b.adult is True
    assert e4b.size_mb == 4455
    assert e4b.filename == "Gemma-4-E4B-it-uncensored-pruned-TextOnly-EnglishOnly-Q4_K_M.gguf"


def test_catalog_bootstrap_is_opt_in_for_downloadable_artifacts():
    assert bootstrap_text_models() == ()
    assert bootstrap_image_models() == ()
