#!/usr/bin/env python3
"""Read the live nginx server block and systemd unit. Print KEY=value lines.

This does not change files. Paths come from the text it is given, not from defaults.
"""

from __future__ import annotations

import argparse
import os
import re
import shlex
import sys

SERVER_NAME = "depthm.yeonsung.ac.kr"
SAFE_PATH = re.compile(r"^/[A-Za-z0-9._/-]+$")
SAFE_NAME = re.compile(r"^[A-Za-z0-9@._-]+$")
BROAD = {"/", "/var", "/var/www", "/usr", "/etc", "/home", "/root", "/tmp", "/var/lib"}


class LayoutError(Exception):
    pass


def strip_inline_comment(line: str) -> str:
    out = []
    quote = ""
    for ch in line:
        if quote:
            out.append(ch)
            if ch == quote:
                quote = ""
            continue
        if ch in {'"', "'"}:
            quote = ch
            out.append(ch)
            continue
        if ch == "#":
            break
        out.append(ch)
    return "".join(out)


def unquote(token: str) -> str:
    token = token.strip()
    if len(token) >= 2 and token[0] == token[-1] and token[0] in {'"', "'"}:
        return token[1:-1]
    return token.rstrip(";")


def walk_directives(text: str):
    """Yield (depth, directive, argument) for nginx-like text."""
    depth = 0
    for raw in text.splitlines():
        if raw.startswith("# configuration file "):
            continue
        line = strip_inline_comment(raw).strip()
        while line:
            if line[0] == "{":
                depth += 1
                line = line[1:].strip()
                continue
            if line[0] == "}":
                depth = max(0, depth - 1)
                line = line[1:].strip()
                continue
            brace_at = line.find("{")
            semi_at = line.find(";")
            semicolon = re.match(r"([A-Za-z_]+)\s+(.+?)\s*;", line)
            if semicolon and (brace_at == -1 or semi_at < brace_at):
                yield depth, semicolon.group(1), unquote(semicolon.group(2).strip())
                line = line[semicolon.end() :].strip()
                continue
            named = re.match(r"([A-Za-z_]+)\s*\{", line)
            if named:
                yield depth, named.group(1), ""
                depth += 1
                line = line[named.end() :].strip()
                continue
            block = re.match(r"([A-Za-z_]+)\s+(.+?)\s*\{", line)
            if block:
                yield depth, block.group(1), unquote(block.group(2).strip())
                depth += 1
                line = line[block.end() :].strip()
                continue
            break


def nginx_layout(text: str) -> dict[str, str]:
    """Return the document root and API port for depthm.yeonsung.ac.kr."""
    http_root = ""
    servers: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    server_depth = -1
    for depth, name, arg in walk_directives(text):
        if current is not None and depth < server_depth:
            servers.append(current)
            current = None
            server_depth = -1
        if name == "server" and arg == "" and current is None:
            current = {"root": http_root, "names": "", "port": ""}
            server_depth = depth + 1
            continue
        if current is None:
            if name == "root" and depth <= 1:
                http_root = arg
            continue
        if depth != server_depth:
            if name == "proxy_pass" and "127.0.0.1:" in arg and not current["port"]:
                port_match = re.search(r"127\.0\.0\.1:(\d+)", arg)
                if port_match:
                    current["port"] = port_match.group(1)
            continue
        if name == "root":
            current["root"] = arg
        elif name == "server_name":
            current["names"] = f"{current['names']} {arg}".strip()
        elif name == "proxy_pass" and "127.0.0.1:" in arg:
            port_match = re.search(r"127\.0\.0\.1:(\d+)", arg)
            if port_match:
                current["port"] = port_match.group(1)
    if current is not None:
        servers.append(current)

    matched = [item for item in servers if SERVER_NAME in item["names"].split()]
    if not matched:
        raise LayoutError(f"nginx 설정에서 {SERVER_NAME} 서버 블록을 찾지 못했습니다.")
    roots = {item["root"] for item in matched if item["root"]}
    if len(roots) != 1:
        raise LayoutError(f"문서 루트가 하나로 정해지지 않습니다: {sorted(roots) or '없음'}")
    ports = {item["port"] for item in matched if item["port"]}
    if len(ports) > 1:
        raise LayoutError(f"자료 API 포트가 서로 다릅니다: {sorted(ports)}")
    root = roots.pop()
    if not SAFE_PATH.fullmatch(root) or root in BROAD:
        raise LayoutError(f"문서 루트로 쓸 수 없는 경로입니다: {root}")
    return {"DOCROOT": root, "API_PORT": ports.pop() if ports else "", "SERVER_NAME": SERVER_NAME}


def parse_env_file(path: str) -> dict[str, str]:
    env: dict[str, str] = {}
    with open(path, encoding="utf-8") as handle:
        for raw in handle:
            line = raw.split("#", 1)[0].strip()
            if not line or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env[key.strip()] = unquote(value.strip())
    return env


def parse_environment(rest: str, env: dict[str, str]) -> None:
    try:
        parts = shlex.split(rest)
    except ValueError as error:
        raise LayoutError(f"Environment 줄을 읽지 못했습니다: {rest}") from error
    for part in parts:
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        env[key] = value


def systemd_layout(text: str) -> dict[str, str]:
    env: dict[str, str] = {}
    user = ""
    work = ""
    for raw in text.splitlines():
        if raw.startswith("#"):
            continue
        line = raw.split("#", 1)[0].strip()
        if not line or line.startswith("["):
            continue
        if line.startswith("EnvironmentFile="):
            path = line.split("=", 1)[1].strip()
            optional = path.startswith("-")
            path = path[1:] if optional else path
            if os.path.isfile(path):
                env.update(parse_env_file(path))
            elif not optional:
                raise LayoutError(f"EnvironmentFile이 없습니다: {path}")
            continue
        if line.startswith("Environment="):
            parse_environment(line.split("=", 1)[1], env)
            continue
        if line.startswith("User="):
            user = unquote(line.split("=", 1)[1].strip())
        elif line.startswith("WorkingDirectory="):
            work = unquote(line.split("=", 1)[1].strip())
    materials = env.get("MATERIALS_DIR", "")
    db = env.get("DEPTHM_DB", "")
    port = env.get("PORT", "")
    if not user or not SAFE_NAME.fullmatch(user):
        raise LayoutError("systemd User가 없습니다.")
    if not work or not SAFE_PATH.fullmatch(work):
        raise LayoutError("systemd WorkingDirectory가 없습니다.")
    if not materials or not SAFE_PATH.fullmatch(materials):
        raise LayoutError("MATERIALS_DIR가 없습니다.")
    if not db or not SAFE_PATH.fullmatch(db):
        raise LayoutError("DEPTHM_DB가 없습니다.")
    if port and not re.fullmatch(r"\d{2,5}", port):
        raise LayoutError(f"PORT가 올바르지 않습니다: {port}")
    parent = os.path.dirname(materials.rstrip("/"))
    data_root = materials if parent in BROAD else parent
    if not SAFE_PATH.fullmatch(data_root):
        raise LayoutError(f"자료 디렉터리로 쓸 수 없는 경로입니다: {data_root}")
    return {
        "APP_ROOT": work,
        "SERVICE_USER": user,
        "MATERIALS_DIR": materials,
        "DATA_ROOT": data_root,
        "DB_PATH": db,
        "UNIT_PORT": port,
    }


def emit(values: dict[str, str]) -> None:
    for key in (
        "DOCROOT",
        "APP_ROOT",
        "SERVICE_USER",
        "MATERIALS_DIR",
        "DATA_ROOT",
        "DB_PATH",
        "API_PORT",
        "SERVER_NAME",
        "SERVICE",
    ):
        value = values[key]
        if key == "SERVICE_USER" or key == "SERVICE":
            if not SAFE_NAME.fullmatch(value):
                raise LayoutError(f"{key} 값이 올바르지 않습니다.")
        elif key == "API_PORT":
            if not re.fullmatch(r"\d{2,5}", value):
                raise LayoutError("API 포트가 없습니다.")
        elif key == "SERVER_NAME":
            if value != SERVER_NAME:
                raise LayoutError("서버 이름이 예상과 다릅니다.")
        elif not SAFE_PATH.fullmatch(value) or value in BROAD:
            raise LayoutError(f"{key} 경로가 올바르지 않습니다: {value}")
        print(f"{key}={value}")


def combine(nginx_text: str, unit_text: str, service: str) -> dict[str, str]:
    nginx = nginx_layout(nginx_text)
    unit = systemd_layout(unit_text)
    port = unit["UNIT_PORT"] or nginx["API_PORT"]
    if unit["UNIT_PORT"] and nginx["API_PORT"] and unit["UNIT_PORT"] != nginx["API_PORT"]:
        raise LayoutError(
            f"유닛 PORT({unit['UNIT_PORT']})와 nginx 프록시 포트({nginx['API_PORT']})가 다릅니다."
        )
    if not port:
        raise LayoutError("자료 API 포트를 유닛과 nginx에서 찾지 못했습니다.")
    values = {
        "DOCROOT": nginx["DOCROOT"],
        "SERVER_NAME": nginx["SERVER_NAME"],
        "API_PORT": port,
        "APP_ROOT": unit["APP_ROOT"],
        "SERVICE_USER": unit["SERVICE_USER"],
        "MATERIALS_DIR": unit["MATERIALS_DIR"],
        "DATA_ROOT": unit["DATA_ROOT"],
        "DB_PATH": unit["DB_PATH"],
        "SERVICE": service,
    }
    return values


def self_test() -> None:
    nginx = """
    server {
        listen 80;
        server_name depthm.yeonsung.ac.kr;
        return 301 https://$host$request_uri;
    }
    server {
        listen 443 ssl;
        server_name depthm.yeonsung.ac.kr;
        root /var/www/depthm;
        location /secret/ {
            root /var/www/depthm-data;
        }
        location /materials-api/ {
            proxy_pass http://127.0.0.1:8787/;
        }
    }
    """
    unit = """
    [Service]
    User=depthm
    WorkingDirectory=/var/www/depthm-app
    Environment=NODE_ENV=production
    Environment=PORT=8787
    Environment=MATERIALS_DIR=/var/www/depthm-data/materials
    Environment=DEPTHM_DB=/var/www/depthm-data/depthm.sqlite
    """
    found = combine(nginx, unit, "depthm-api")
    assert found["DOCROOT"] == "/var/www/depthm", found
    assert found["DATA_ROOT"] == "/var/www/depthm-data", found
    assert found["DB_PATH"] == "/var/www/depthm-data/depthm.sqlite"
    assert found["API_PORT"] == "8787"
    assert found["APP_ROOT"] == "/var/www/depthm-app"

    mismatched = nginx.replace("root /var/www/depthm;", "root /var/www/other;")
    try:
        combine(mismatched + "\nserver { server_name depthm.yeonsung.ac.kr; root /var/www/depthm; }\n", unit, "depthm-api")
    except LayoutError:
        pass
    else:
        raise AssertionError("서로 다른 문서 루트를 통과시켰습니다.")

    try:
        combine("server { server_name example.com; root /var/www/depthm; }\n", unit, "depthm-api")
    except LayoutError:
        pass
    else:
        raise AssertionError("다른 서버 이름을 통과시켰습니다.")
    print("read-server-layout self-test ok")


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        self_test()
        return 0
    parser = argparse.ArgumentParser()
    parser.add_argument("--nginx-file", required=True)
    parser.add_argument("--unit-file", required=True)
    parser.add_argument("--service", required=True)
    args = parser.parse_args()
    try:
        nginx_text = open(args.nginx_file, encoding="utf-8").read()
        unit_text = open(args.unit_file, encoding="utf-8").read()
        emit(combine(nginx_text, unit_text, args.service))
    except LayoutError as error:
        print(str(error), file=sys.stderr)
        return 1
    except OSError as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
