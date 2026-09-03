import asyncio
import sys
from types import SimpleNamespace


_original_argv = sys.argv
sys.argv = [sys.argv[0]]
try:
    from lightrag.api.routers.workspace_routes import _drop_workspace_graph
    from lightrag.kg.postgres_impl import PostgreSQLDB
finally:
    sys.argv = _original_argv


class _FakeTransaction:
    def __init__(self, connection):
        self.connection = connection

    async def __aenter__(self):
        self.connection.transaction_started = True

    async def __aexit__(self, exc_type, exc, traceback):
        self.connection.transaction_rolled_back = exc_type is not None
        self.connection.transaction_committed = exc_type is None
        return False


class _FakeConnection:
    def __init__(self, tables, fail_table=None):
        self.tables = tables
        self.fail_table = fail_table
        self.executed = []
        self.transaction_started = False
        self.transaction_committed = False
        self.transaction_rolled_back = False

    def transaction(self):
        return _FakeTransaction(self)

    async def fetch(self, sql):
        assert "information_schema.columns" in sql
        return [
            {"table_schema": "public", "table_name": table}
            for table in self.tables
        ]

    async def execute(self, sql, *params):
        self.executed.append((sql, params))
        if self.fail_table and f'"{self.fail_table}"' in sql:
            raise RuntimeError("simulated delete failure")
        return "DELETE 1"


def _database_with_connection(connection):
    database = object.__new__(PostgreSQLDB)

    async def run_with_retry(operation, **_kwargs):
        return await operation(connection)

    database._run_with_retry = run_with_retry
    return database


def test_workspace_delete_discovers_all_supported_workspace_tables():
    connection = _FakeConnection(
        [
            "lightrag_answer_vectors",
            "lightrag_source_connectors",
            "lightrag_tasks",
            "kms_admin_knowledge_refs",
        ]
    )
    database = _database_with_connection(connection)

    result = asyncio.run(database.delete_workspace("obsolete-faq"))

    assert result is True
    assert connection.transaction_committed is True
    assert connection.transaction_rolled_back is False
    statements = [sql for sql, _ in connection.executed]
    assert any('"lightrag_answer_vectors"' in sql for sql in statements)
    assert any('"lightrag_source_connectors"' in sql for sql in statements)
    assert any('"lightrag_tasks"' in sql for sql in statements)
    assert any('"kms_admin_knowledge_refs"' in sql for sql in statements)
    assert "DELETE FROM LIGHTRAG_WORKSPACES" in statements[-1]
    assert all(params == ("obsolete-faq",) for _, params in connection.executed)


def test_workspace_delete_rolls_back_before_registry_delete_on_table_failure():
    connection = _FakeConnection(
        ["lightrag_answer_items", "lightrag_answer_vectors"],
        fail_table="lightrag_answer_vectors",
    )
    database = _database_with_connection(connection)

    result = asyncio.run(database.delete_workspace("broken-delete"))

    assert result is False
    assert connection.transaction_committed is False
    assert connection.transaction_rolled_back is True
    assert not any(
        "DELETE FROM LIGHTRAG_WORKSPACES" in sql for sql, _ in connection.executed
    )


def test_workspace_delete_can_remove_registry_without_deleting_data():
    connection = _FakeConnection(["lightrag_answer_items"])
    database = _database_with_connection(connection)

    result = asyncio.run(
        database.delete_workspace("registry-only", delete_data=False)
    )

    assert result is True
    assert len(connection.executed) == 1
    assert "DELETE FROM LIGHTRAG_WORKSPACES" in connection.executed[0][0]


class _FakeGraph:
    def __init__(self, result):
        self.result = result
        self.drop_called = False

    async def drop(self):
        self.drop_called = True
        return self.result


def test_graph_delete_uses_only_the_exact_workspace_instance():
    graph = _FakeGraph({"status": "success", "message": "deleted"})
    workspace_rag = SimpleNamespace(
        workspace="target-workspace",
        chunk_entity_relation_graph=graph,
    )

    result = asyncio.run(_drop_workspace_graph(workspace_rag, "target-workspace"))

    assert result["status"] == "success"
    assert graph.drop_called is True


def test_graph_delete_rejects_default_workspace_fallback():
    graph = _FakeGraph({"status": "success"})
    default_rag = SimpleNamespace(
        workspace="base",
        chunk_entity_relation_graph=graph,
    )

    try:
        asyncio.run(_drop_workspace_graph(default_rag, "missing-workspace"))
    except RuntimeError as error:
        assert "belongs to 'base'" in str(error)
    else:
        raise AssertionError("Mismatched workspace graph deletion was not rejected")

    assert graph.drop_called is False


def test_graph_delete_treats_storage_error_result_as_failure():
    graph = _FakeGraph({"status": "error", "message": "neo4j unavailable"})
    workspace_rag = SimpleNamespace(
        workspace="target-workspace",
        chunk_entity_relation_graph=graph,
    )

    try:
        asyncio.run(_drop_workspace_graph(workspace_rag, "target-workspace"))
    except RuntimeError as error:
        assert "neo4j unavailable" in str(error)
    else:
        raise AssertionError("Graph storage error was not propagated")
