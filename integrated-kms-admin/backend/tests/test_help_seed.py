from kms_admin.help_seed import load_help_seed_topics, nav_key_for_help_id


def test_help_seed_loads_content_and_visibility():
    topics = load_help_seed_topics()

    assert len(topics) == 26
    search = next(topic for topic in topics if topic.help_id == "HELP-SEARCH-001")
    assert search.nav_key == "search"
    assert search.menu_label == "통합 검색"
    assert search.visibility == {"user": True, "manager": True, "admin": True}
    assert search.screenshot_path == "/help/screenshots/search/search-basic.png"
    assert "통합 검색 사용하기" in search.body_md


def test_help_seed_maps_known_prefixes_to_nav_keys():
    assert nav_key_for_help_id("HELP-KNOWLEDGE-001") == "knowledge"
    assert nav_key_for_help_id("HELP-CATEGORY-001") == "categories"
    assert nav_key_for_help_id("HELP-EXTERNAL-001") == "external"


def test_help_seed_uses_generic_category_examples():
    topics = load_help_seed_topics()
    category_filter = next(topic for topic in topics if topic.help_id == "HELP-SEARCH-002")

    assert "이핏 > 충전" not in category_filter.body_md
    assert "서비스 안내 > 이용 방법" in category_filter.body_md
