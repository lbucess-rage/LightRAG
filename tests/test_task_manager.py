import asyncio

from lightrag.api.task_manager import TaskService, TaskStatus, TaskType


def test_cancelled_task_cannot_be_completed_after_worker_returns():
    service = TaskService()
    task = service.create_task(TaskType.FAQ_GRAPH_REBUILD, workspace="faq-test")

    assert asyncio.run(service.cancel_task(task.task_id))
    asyncio.run(service.complete_task(task.task_id, result={"rebuilt": ["ANS-1"]}))

    stored = service.get_task(task.task_id)
    assert stored is not None
    assert stored.status == TaskStatus.CANCELLED
    assert stored.result is None
