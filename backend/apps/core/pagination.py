from rest_framework.pagination import PageNumberPagination


class StandardPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 200


class TaskBoardPagination(PageNumberPagination):
    """Higher-capacity pagination for the per-user task board (/me/tasks/).

    The SelfBoard renders ALL of a user's tasks (active columns + done-today +
    history) from a single fetch, so a 200 cap silently drops the newest tasks
    once a role's backlog (incl. done history) exceeds the page. This raises the
    ceiling well above a season's per-role task count. Other list endpoints keep
    StandardPagination's 200 cap.
    """

    page_size = 1000
    page_size_query_param = 'page_size'
    max_page_size = 2000
