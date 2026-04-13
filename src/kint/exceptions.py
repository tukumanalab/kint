"""カスタム例外クラス。"""


class KintError(Exception):
    """Kint 基底例外。"""

    def __init__(self, code: str, message: str, detail: dict | None = None) -> None:
        self.code = code
        self.message = message
        self.detail = detail
        super().__init__(message)


class KintNotFoundError(KintError):
    """リソースが見つからない場合の例外。HTTP 404 にマッピングされる。"""


class KintConflictError(KintError):
    """競合が発生した場合の例外。HTTP 409 にマッピングされる。"""


class KintForbiddenError(KintError):
    """権限不足の例外。HTTP 403 にマッピングされる。"""


class KintUnauthorizedError(KintError):
    """未認証の例外。HTTP 401 にマッピングされる。"""


class KintBadRequestError(KintError):
    """不正リクエストの例外。HTTP 400 にマッピングされる。"""


class KintBadGatewayError(KintError):
    """上位ゲートウェイ障害の例外。HTTP 502 にマッピングされる。"""
