from urllib.parse import quote

from fastapi import Response


def attachment(
    content: bytes, filename: str, content_type: str, response: Response
) -> Response:
    download = Response(
        content,
        media_type=content_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Cache-Control": "no-store",
        },
    )
    download.raw_headers.extend(
        (name, value) for name, value in response.raw_headers if name == b"set-cookie"
    )
    return download
