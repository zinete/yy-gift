"""Build and search a local visual index of the existing Supabase meme library."""
import argparse
import base64
import hashlib
import io
import ipaddress
import json
import math
import os
import sqlite3
import socket
import subprocess
import sys
import uuid
from contextlib import closing
from functools import lru_cache
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit

import certifi
import requests
import urllib3
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / ".visual-index.sqlite3"
ASSETS = ROOT / ".visual-assets"
IMAGE_EXTENSIONS = {"GIF": "gif", "PNG": "png", "JPEG": "jpg", "WEBP": "webp", "BMP": "bmp"}
OLLAMA = "http://127.0.0.1:11434"
VISION = "qwen3-vl:2b"
VISION_INSTRUCT = "qwen3-vl:2b-instruct"
EMBED = "nomic-embed-text:latest"
MAX_IMAGE_BYTES = 15 * 1024 * 1024
STORAGE_BUCKET = "yy-meme-originals"
IMAGE_MIME_TYPES = {"GIF": "image/gif", "PNG": "image/png", "JPEG": "image/jpeg",
                    "WEBP": "image/webp", "BMP": "image/bmp"}


def env():
    values = {}
    path = ROOT / ".env.local"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip('"\'')
    return {**values, **os.environ}


def call(endpoint, payload):
    response = requests.post(OLLAMA + endpoint, json=payload, timeout=(5, 120))
    if not response.ok:
        raise ValueError(f"Ollama HTTP {response.status_code}: {response.text[:200]}")
    return response.json()


def embed(text):
    return call("/api/embed", {"model": EMBED, "input": text})["embeddings"][0]


def download_image(url):
    # Validate every redirect, and connect to the validated IP without resolving again.
    for _ in range(4):
        parts = urlsplit(url)
        port = 443 if parts.scheme == "https" else 80
        if (parts.scheme not in {"http", "https"} or not parts.hostname or
                parts.username is not None or parts.port not in {None, port}):
            raise ValueError("图片必须使用公开 HTTP(S) 地址")
        addresses = {item[4][0] for item in socket.getaddrinfo(parts.hostname, port, type=socket.SOCK_STREAM)}
        if not addresses or any(
            not (ip := ipaddress.ip_address(address)).is_global or ip.is_multicast
            for address in addresses
        ):
            raise ValueError("图片地址指向非公开网络")
        address = min(addresses, key=lambda item: (":" in item, item))
        pool = (urllib3.HTTPSConnectionPool(address, port, server_hostname=parts.hostname,
                                           assert_hostname=parts.hostname, ca_certs=certifi.where())
                if parts.scheme == "https" else urllib3.HTTPConnectionPool(address, port))
        target = requests.utils.requote_uri(urlunsplit(("", "", parts.path or "/", parts.query, "")))
        with closing(pool):
            with pool.urlopen("GET", target, headers={"Host": parts.netloc, "User-Agent": "YY-Gift/1.0"},
                              preload_content=False, redirect=False, retries=False,
                              timeout=urllib3.Timeout(connect=8, read=8)) as response:
                if response.status in {301, 302, 303, 307, 308} and response.headers.get("Location"):
                    url = urljoin(url, response.headers["Location"])
                    continue
                if response.status != 200:
                    raise ValueError(f"图片下载失败（HTTP {response.status}）")
                content = response.read(MAX_IMAGE_BYTES + 1, decode_content=False)
                if len(content) > MAX_IMAGE_BYTES:
                    raise ValueError("图片超过 15 MB")
                return content
    raise ValueError("图片重定向过多")


def frames(content):
    result = []
    with Image.open(io.BytesIO(content), formats=list(IMAGE_EXTENSIONS)) as image:
        if image.width * image.height > 12_000_000:
            raise ValueError("图片尺寸过大")
        # Sample near the beginning, without decoding an arbitrarily long animation.
        indexes = [0, 5] if getattr(image, "is_animated", False) else [0]
        for index in indexes:
            try:
                image.seek(index)
            except EOFError:
                break
            rgba = ImageOps.exif_transpose(image.convert("RGBA"))
            rgba.thumbnail((256, 256))
            frame = Image.new("RGB", rgba.size, "white")
            frame.paste(rgba, mask=rgba.getchannel("A"))
            buffer = io.BytesIO()
            frame.save(buffer, format="JPEG", quality=85)
            encoded = base64.b64encode(buffer.getvalue()).decode()
            if encoded not in result:
                result.append(encoded)
    return result


def cached_image(ident):
    # The ID comes from the database. Do not use external URLs as filenames.
    ident = str(uuid.UUID(ident))
    for extension in IMAGE_EXTENSIONS.values():
        path = ASSETS / f"{ident}.{extension}"
        if path.is_file():
            return path
    return None


def original_format(content):
    if len(content) > MAX_IMAGE_BYTES:
        raise ValueError("图片超过 15 MB")
    with Image.open(io.BytesIO(content), formats=list(IMAGE_EXTENSIONS)) as image:
        if image.width * image.height > 12_000_000:
            raise ValueError("图片尺寸过大")
        image.load()
        return image.format


@lru_cache(maxsize=1)
def vision_model():
    response = requests.get(OLLAMA + "/api/tags", timeout=5)
    response.raise_for_status()
    installed = {item["name"] for item in response.json()["models"]}
    if not installed.intersection({VISION, VISION_INSTRUCT}):
        raise ValueError(f"未安装视觉模型，请执行 ollama pull {VISION_INSTRUCT}")
    return VISION_INSTRUCT if VISION_INSTRUCT in installed else VISION


def analyze(url):
    return analyze_image(download_image(url))


def analyze_image(image_bytes):
    model = vision_model()
    images = frames(image_bytes)
    result = call("/api/chat", {
        "model": model,
        "stream": False,
        "format": "json",
        "options": {"num_ctx": 4096, "num_predict": 160 if model == VISION_INSTRUCT else 512, "temperature": 0},
        "messages": [{
            "role": "user",
            "content": (
                '按所见用中文输出 JSON：{"description":"一句话描述主体、动作、表情和道具",'
                '"tags":["主体","动作","表情或道具"]}。标签尽量用2到8字，不猜测角色名字。'
                "多图是同一个动图的代表帧，合并描述。"
            ),
            "images": images if model == VISION_INSTRUCT else images[:1],
        }],
    })
    content = result["message"]["content"]
    if not content.strip():
        raise ValueError("视觉模型没有返回描述。建议使用 qwen3-vl:2b-instruct")
    data = json.loads(content)
    if not isinstance(data, dict):
        raise ValueError("视觉模型未返回有效的描述和标签")
    description = data.get("description")
    if not isinstance(description, str) or not description.strip():
        raise ValueError("视觉模型返回了空描述")
    tags = data.get("tags")
    tags = tags if isinstance(tags, list) else []
    clean_tags = list(dict.fromkeys(
        tag.strip() for tag in tags
        if isinstance(tag, str) and 2 <= len(tag.strip()) <= 12 and tag.strip().isalnum()
        and tag.strip() not in {"主体", "动作", "表情", "道具"}
    ))[:4]
    return description.strip()[:240], clean_tags


def supabase_config(*, admin=False):
    config = env()
    url = config.get("VITE_SUPABASE_URL")
    key = config.get("VITE_SUPABASE_ANON_KEY")
    if admin:
        key = config.get("SUPABASE_SECRET_KEY") or config.get("SUPABASE_SERVICE_ROLE_KEY")
        if not key or key.startswith("sb_publishable_") or key == config.get("VITE_SUPABASE_ANON_KEY"):
            raise ValueError("请在本机 .env.local 配置后端专用的 SUPABASE_SECRET_KEY，才能上传原图到 Supabase Storage。")
    if not url or not key:
        raise ValueError(".env.local 缺少 Supabase 配置")
    headers = {"apikey": key}
    if admin and not key.startswith("sb_secret_"):
        headers["Authorization"] = "Bearer " + key
    return url.rstrip("/"), headers


def supabase_request(method, url, **options):
    try:
        return requests.request(method, url, timeout=(8, 45), allow_redirects=False, **options)
    except requests.exceptions.SSLError as exc:
        raise ValueError("Supabase 的 HTTPS 证书校验失败。请检查系统时间、证书和代理设置。") from exc
    except requests.exceptions.Timeout as exc:
        raise ValueError("连接 Supabase 超时。请检查网络后重试。") from exc
    except requests.exceptions.ConnectionError as exc:
        if "10013" in str(exc):
            raise ValueError("当前开发服务无外网权限。请在普通 PowerShell 中重新运行 npm run dev，再打开新服务地址。") from exc
        raise ValueError("无法连接 Supabase。请检查当前开发服务的网络、代理和项目地址。") from exc


def rest(method, table, *, params=None, body=None, prefer=None, admin=False):
    url, headers = supabase_config(admin=admin)
    if prefer:
        headers["Prefer"] = prefer
    response = supabase_request(method, f"{url}/rest/v1/{table}", headers=headers, params=params, json=body)
    if not 200 <= response.status_code < 300:
        raise ValueError(f"Supabase {table} 请求失败（HTTP {response.status_code}）")
    return response.json() if response.content else None


def storage_error(response):
    try:
        data = response.json()
    except ValueError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    return str(data.get("statusCode", response.status_code)), str(data.get("message", "")).lower()


@lru_cache(maxsize=1)
def ensure_storage_bucket():
    url, headers = supabase_config(admin=True)
    bucket_url = f"{url}/storage/v1/bucket/{STORAGE_BUCKET}"
    bucket = supabase_request("GET", bucket_url, headers=headers)
    if not bucket.ok:
        code, message = storage_error(bucket)
        if code != "404" and "bucket not found" not in message:
            raise ValueError(f"无法读取 Supabase Storage 存储桶（HTTP {bucket.status_code}），请检查后端密钥。")
        created = supabase_request("POST", f"{url}/storage/v1/bucket", headers=headers, json={
            "id": STORAGE_BUCKET, "name": STORAGE_BUCKET, "public": True,
            "file_size_limit": MAX_IMAGE_BYTES, "allowed_mime_types": list(IMAGE_MIME_TYPES.values()),
        })
        code, message = storage_error(created)
        if not created.ok and code != "409" and "already exists" not in message:
            raise ValueError(f"无法创建 Supabase Storage 存储桶（HTTP {created.status_code}）")
        bucket = supabase_request("GET", bucket_url, headers=headers)
    if not bucket.ok or bucket.json().get("public") is not True:
        raise ValueError(f"Supabase 的 {STORAGE_BUCKET} 存储桶必须允许公开读取，图库才能显示图片。")


def public_storage_prefix():
    url, _ = supabase_config()
    return f"{url}/storage/v1/object/public/{STORAGE_BUCKET}/"


def upload_original(source_url, source_digest, content):
    image_format = original_format(content)
    ensure_storage_bucket()
    url, headers = supabase_config(admin=True)
    checksum = hashlib.sha256(content).hexdigest()
    path = f"originals/{source_digest}/{checksum}.{IMAGE_EXTENSIONS[image_format]}"
    # Supabase stores provenance as object metadata. The browser uses the stable public URL.
    metadata = base64.b64encode(json.dumps({"source_url": source_url}).encode()).decode()
    uploaded = supabase_request("POST", f"{url}/storage/v1/object/{STORAGE_BUCKET}/{path}", data=content, headers={
        **headers, "content-type": IMAGE_MIME_TYPES[image_format], "cache-control": "max-age=31536000",
        "x-upsert": "false", "x-metadata": metadata,
    })
    code, message = storage_error(uploaded)
    if not uploaded.ok and code != "409" and "already exists" not in message:
        raise ValueError(f"Supabase Storage 上传失败（HTTP {uploaded.status_code}）")
    public_url = public_storage_prefix() + path
    with supabase_request("GET", public_url, stream=True, headers={"Accept-Encoding": "identity"}) as published:
        if (published.status_code != 200 or
                published.headers.get("Content-Type", "").split(";")[0] != IMAGE_MIME_TYPES[image_format] or
                published.raw.read(len(content) + 1) != content):
            raise ValueError("无法校验公开 Storage 地址上的原图，表情包记录未更新。")
    return public_url


def library():
    result = []
    for offset in range(0, 100000, 500):
        rows = rest("GET", "memes_with_tags", params={
            "select": "id,title,image_url,image_url_hash,tags", "order": "id", "offset": offset, "limit": 500,
        })
        result.extend(rows)
        if len(rows) < 500:
            break
    return result


def put_index(db, row, description, tags):
    text = " ".join([row["title"], *tags, description])
    vector = embed("search_document: " + text)
    db.execute("INSERT OR REPLACE INTO images VALUES (?,?,?,?,?)",
               (row["id"], row["image_url"], row["title"], description, json.dumps(vector)))
    db.commit()


def index_library(db, limit):
    indexed = dict(db.execute("SELECT id,url FROM images"))
    rows = library()
    current = {row["id"]: row["image_url"] for row in rows}
    obsolete = [(ident, url) for ident, url in indexed.items() if current.get(ident) != url]
    db.executemany("DELETE FROM images WHERE id=? AND url=?", obsolete)
    db.commit()
    pending = [row for row in rows if indexed.get(row["id"]) != row["image_url"]]
    result = {"total": len(rows), "pending": len(pending), "indexed": 0, "failed": 0, "errors": []}
    print(f"素材 {len(rows)} 条，待识别 {len(pending)} 条", file=sys.stderr, flush=True)
    if pending:
        vision_model()
    for row in pending[:limit]:
        try:
            local = cached_image(row["id"])
            description, tags = analyze_image(local.read_bytes()) if local else analyze(row["image_url"])
            put_index(db, row, description, list(dict.fromkeys([*(row["tags"] or []), *tags])))
            result["indexed"] += 1
        except (OSError, ValueError, KeyError, urllib3.exceptions.HTTPError, requests.RequestException) as exc:
            result["failed"] += 1
            result["errors"].append(f"{row['id']}: {exc}")
        print(f"已识别 {result['indexed']} 张，失败 {result['failed']} 张", file=sys.stderr, flush=True)
    return result


def search_index(db, query, limit):
    rows = db.execute("SELECT id,url,title,description,vector FROM images").fetchall()
    if not rows:
        return []
    query_vector = embed("search_query: " + query)
    query_norm = sum(value * value for value in query_vector)
    matches = []
    for ident, url, title, description, raw in rows:
        vector = json.loads(raw)
        if len(query_vector) != len(vector):
            continue
        denominator = math.sqrt(query_norm * sum(value * value for value in vector))
        score = sum(a*b for a, b in zip(query_vector, vector)) / denominator if denominator else 0
        matches.append({"id": ident, "image_url": url, "title": title,
                        "description": description, "score": round(score, 4)})
    return sorted(matches, key=lambda match: match["score"], reverse=True)[:limit]


def discover(query, limit):
    if query.startswith(("https://", "http://")):
        return [query]
    output = subprocess.run(
        ["node", "--import", "tsx", "scripts/crawler-hd.ts", query, "--discover", "--max", str(limit)],
        cwd=ROOT, capture_output=True, encoding="utf-8", timeout=40, check=True,
    )
    return json.loads(output.stdout.strip().splitlines()[-1])


def source_hash(url):
    normalized = urlunsplit(urlsplit(url)._replace(query="", fragment=""))
    return hashlib.sha256(normalized.encode()).hexdigest()


def existing_image_bytes(row):
    local = cached_image(row["id"])
    if local and not row["image_url"].startswith(public_storage_prefix()):
        return local.read_bytes()
    return download_image(row["image_url"])


def set_storage_url(db, row, public_url, digest):
    original_url = row["image_url"]
    updated = rest("PATCH", "memes", admin=True, params={
        "id": f"eq.{row['id']}", "image_url": f"eq.{original_url}",
    }, body={"image_url": public_url, "image_url_hash": digest}, prefer="return=representation")
    if not updated:
        raise ValueError("表情包在上传期间已变更，请重试。")
    db.execute("UPDATE images SET url=? WHERE id=? AND url=?", (public_url, row["id"], original_url))
    db.commit()
    return updated[0]


def migrate_local_images(db, limit, dry_run):
    prefix = public_storage_prefix()
    candidates = [row for row in library() if not row["image_url"].startswith(prefix) and cached_image(row["id"])]
    pending = candidates[:limit]
    result = {"found": len(pending), "restored": 0, "failed": 0, "errors": []}
    if dry_run or not pending:
        return result
    supabase_config(admin=True)
    for row in pending:
        try:
            source = row["image_url"]
            digest = row.get("image_url_hash") or source_hash(source)
            target = upload_original(source, digest, existing_image_bytes(row))
            set_storage_url(db, row, target, digest)
            result["restored"] += 1
        except (OSError, ValueError, urllib3.exceptions.HTTPError, requests.RequestException,
                Image.DecompressionBombError) as exc:
            result["failed"] += 1
            result["errors"].append(f"{row['id']}: {exc}")
    return result


def import_image(db, url, dry_run):
    digest = source_hash(url)
    matching = rest("GET", "memes_with_tags", params={
        "select": "id,image_url,image_url_hash,title,tags", "image_url_hash": f"eq.{digest}", "limit": 1,
    })
    if not matching:
        matching = rest("GET", "memes_with_tags", params={
            "select": "id,image_url,image_url_hash,title,tags", "image_url": f"eq.{url}", "limit": 1,
        })
    existing = matching[0] if matching else None
    managed = existing and existing["image_url"].startswith(public_storage_prefix())
    if existing and existing["tags"]:
        if dry_run or managed:
            return {"status": "duplicate"}
        source = existing["image_url"]
        digest = existing.get("image_url_hash") or source_hash(source)
        public_url = upload_original(source, digest, existing_image_bytes(existing))
        set_storage_url(db, existing, public_url, digest)
        return {"status": "restored", "description": existing["title"], "tags": existing["tags"], "image_url": public_url}
    source = existing["image_url"] if existing else url
    image_bytes = existing_image_bytes(existing) if existing else download_image(url)
    description, tags = analyze_image(image_bytes)
    tags = tags or ["其他"]
    if dry_run:
        return {"status": "preview", "description": description, "tags": tags, "image_url": url}
    if existing:
        digest = existing.get("image_url_hash") or source_hash(source)
    public_url = source if managed else upload_original(source, digest, image_bytes)
    rest("POST", "tags", admin=True, params={"on_conflict": "name"}, body=[{"name": tag} for tag in tags],
         prefer="resolution=ignore-duplicates,return=minimal")
    tag_rows = rest("GET", "tags", params={"select": "id", "name": "in.(" + ",".join(tags) + ")"})
    if len(tag_rows) != len(tags):
        raise ValueError("未能取得全部分类标签")
    if existing is None:
        rows = rest("POST", "memes", admin=True, params={"on_conflict": "image_url_hash"},
                    body={"title": description, "image_url": public_url, "image_url_hash": digest},
                    prefer="resolution=ignore-duplicates,return=representation")
        if not rows:
            return {"status": "duplicate"}
        existing = rows[0]
    elif not managed:
        existing = set_storage_url(db, existing, public_url, digest)
    rest("POST", "memes_tags", admin=True, params={"on_conflict": "meme_id,tag_id"},
         body=[{"meme_id": existing["id"], "tag_id": tag["id"]} for tag in tag_rows],
         prefer="resolution=ignore-duplicates,return=minimal")
    result = {"status": "saved", "description": description, "tags": tags, "image_url": public_url}
    try:
        put_index(db, existing, description, tags)
    except (OSError, ValueError, KeyError, requests.RequestException, sqlite3.Error) as exc:
        result["index_error"] = str(exc)
    return result


def crawl(db, query, limit, dry_run):
    if not dry_run:
        supabase_config(admin=True)
    urls = discover(query, limit)
    if urls:
        vision_model()
    result = {"found": len(urls), "saved": 0, "restored": 0, "duplicate": 0, "failed": 0, "items": [], "errors": []}
    for url in urls:
        try:
            item = import_image(db, url, dry_run)
            if item["status"] != "preview":
                result[item["status"]] += 1
            if item["status"] != "duplicate":
                result["items"].append(item)
        except (OSError, ValueError, KeyError, urllib3.exceptions.HTTPError, requests.RequestException,
                Image.DecompressionBombError) as exc:
            result["failed"] += 1
            result["errors"].append(str(exc))
        print(f"已入库 {result['saved']} 张，迁移 {result['restored']} 张，重复 {result['duplicate']} 张，失败 {result['failed']} 张",
              file=sys.stderr, flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description="本地识图和语义找图")
    parser.add_argument("action", choices=["index", "search", "crawl", "migrate-local", "analyze", "status"])
    parser.add_argument("query", nargs="?")
    parser.add_argument("--query", dest="api_query", help=argparse.SUPPRESS)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    args.query = args.api_query if args.api_query is not None else args.query
    if args.action in {"search", "crawl", "analyze"} and not args.query:
        parser.error(f"{args.action} 需要关键词或图片地址")
    with closing(sqlite3.connect(DB)) as db:
        db.execute("CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, url TEXT NOT NULL, title TEXT, description TEXT, vector TEXT NOT NULL)")
        limit = max(1, min(args.limit, 500))
        if args.action == "index":
            result = index_library(db, limit)
        elif args.action == "search":
            result = search_index(db, args.query, limit)
        elif args.action == "crawl":
            result = crawl(db, args.query, min(limit, 10), args.dry_run)
        elif args.action == "migrate-local":
            result = migrate_local_images(db, limit, args.dry_run)
        elif args.action == "analyze":
            description, tags = analyze(args.query)
            result = {"description": description, "tags": tags}
        else:
            result = {"indexed": db.execute("SELECT COUNT(*) FROM images").fetchone()[0]}
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, urllib3.exceptions.HTTPError, requests.RequestException,
            sqlite3.Error, subprocess.SubprocessError) as exc:
        sys.exit(str(exc))
