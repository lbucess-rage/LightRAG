from kms_admin.routers.api_clients import _json_array, _json_object, _normalize_search_log


def test_json_array_accepts_native_list():
    assert _json_array(["search"]) == ["search"]


def test_json_array_parses_json_string():
    assert _json_array('["search", "stream"]') == ["search", "stream"]


def test_json_array_rejects_non_array_values():
    assert _json_array('{"scope": "search"}') == []
    assert _json_array(None) == []


def test_search_log_json_fields_are_normalized_from_strings():
    row = _normalize_search_log(
        {
            "search_id": "s1",
            "category_ids": '["cat-1"]',
            "result_summary": '{"faq_count":1,"has_generative_answer":true}',
        }
    )

    assert row["category_ids"] == ["cat-1"]
    assert row["result_summary"] == {"faq_count": 1, "has_generative_answer": True}
    assert _json_object("not-json") == {}
